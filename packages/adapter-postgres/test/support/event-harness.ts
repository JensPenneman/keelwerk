import type { PlacementConfig, StorageScope, Unit } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createPostgresInstance } from '../../src/create-postgres-instance.ts';
import type { PostgresAdapterInstance } from '../../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './create-test-database.ts';
import { prepareNamespaces } from './prepare-namespaces.ts';
import { prepareStoreTables } from './prepare-store-tables.ts';
import { known } from './store-rows.ts';
import type { TestDatabase } from './test-database.ts';
import { testEnvironment } from './test-environment.ts';
import { testNamespace } from './test-namespace.ts';

/** What a test file works with once `eventHarness` has registered its hooks. */
export interface EventHarness {
  readonly clock: { readonly now: () => Temporal.Instant };
  readonly adapter: () => PostgresAdapterInstance;
  readonly run: <T>(scope: StorageScope, fn: (u: Unit) => Promise<T>) => Promise<T>;
  readonly failure: (work: Promise<unknown>) => Promise<{ kind: string; code: string }>;
  /** A connection of the database owner, for statements the application role may not run. */
  /** Another adapter over the file's database, with a pool of its own; closed after the file's tests. */
  readonly spawn: (poolMax: number) => Promise<PostgresAdapterInstance>;
  readonly owner: <T>(work: (client: pg.Client) => Promise<T>) => Promise<T>;
}

/**
 * Call at the top of a test file: creates the file's own database with the namespaces and the
 * store tables, and an adapter whose pool holds `poolMax` connections, before its tests; empties
 * the framework tables and the ticket table before each test.
 */
export function eventHarness(databaseName: string, poolMax: number): EventHarness {
  let database: TestDatabase | undefined;
  let current: PostgresAdapterInstance | undefined;
  const spawned: PostgresAdapterInstance[] = [];
  const clock = { now: () => Temporal.Now.instant() };
  const adapter = (): PostgresAdapterInstance => {
    if (current === undefined) throw new Error('the event harness is used outside a test');
    return current;
  };
  const owner = async <T>(work: (client: pg.Client) => Promise<T>): Promise<T> => {
    const client = new pg.Client({ connectionString: database?.adminUrl });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  };
  const placement = (url: string, max: number = poolMax): PlacementConfig => ({
    id: 'main',
    url,
    strategy: 'shared-tables',
    pool: { max },
  });
  beforeAll(async () => {
    database = await createTestDatabase(databaseName);
    await prepareNamespaces(database.adminUrl);
    await prepareStoreTables(database.adminUrl);
    current = createPostgresInstance(
      { clock, entities: (ref) => known.get(ref) },
      placement(database.appUrl),
      testEnvironment(),
    );
    await current.connect();
  });
  afterAll(async () => {
    await Promise.all(spawned.map(async (instance) => instance.close(5000)));
    await current?.close(5000);
  });
  beforeEach(async () => {
    await owner(async (client) => {
      const tables = await client.query<{ schemaname: string; tablename: string }>(
        `select schemaname, tablename from pg_tables where schemaname in ('app', 'kw__control') and tablename <> 'kw_migrations'`,
      );
      await client.query(
        `truncate ${tables.rows.map((table) => `${table.schemaname}.${table.tablename}`).join(', ')} restart identity`,
      );
    });
  });
  return {
    clock,
    adapter,
    run: async (scope, fn) => adapter().unit(testNamespace, scope, fn),
    failure: async (work) => {
      try {
        await work;
      } catch (error) {
        if (isKeelwerkError(error)) return { kind: error.kind, code: error.code };
        throw error;
      }
      throw new Error('expected a KeelwerkError');
    },
    spawn: async (max) => {
      if (database === undefined) throw new Error('the event harness is used outside a test');
      const instance = createPostgresInstance(
        { clock, entities: (ref) => known.get(ref) },
        placement(database.appUrl, max),
        testEnvironment(),
      );
      await instance.connect();
      spawned.push(instance);
      return instance;
    },
    owner,
  };
}
