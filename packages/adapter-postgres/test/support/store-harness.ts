import type { PlacementConfig, StorageScope, Unit } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import type { SqlUnit } from '@keelwerk/data';
import { sqlEntityIndex, sqlUnit } from '@keelwerk/data';
import { aesKeyWrapper } from '@keelwerk/data/conformance';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createPostgresInstance } from '../../src/create-postgres-instance.ts';
import type { PostgresAdapterInstance } from '../../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './create-test-database.ts';
import { prepareNamespaces } from './prepare-namespaces.ts';
import { prepareStoreTables } from './prepare-store-tables.ts';
import { known, stamp } from './store-rows.ts';
import type { TestDatabase } from './test-database.ts';
import { testEnvironment } from './test-environment.ts';
import { testNamespace } from './test-namespace.ts';
import { testScopes } from './test-scopes.ts';

const controlNamespace = { ...testNamespace, id: 'ns-control', root: 'kw__control' };

/** What a store test file works with once `storeHarness` has registered its hooks. */
export interface StoreHarness {
  readonly clock: { readonly now: () => Temporal.Instant };
  readonly adapter: () => PostgresAdapterInstance;
  readonly run: <T>(scope: StorageScope, fn: (u: Unit) => Promise<T>) => Promise<T>;
  /** A read-only unit. */
  readonly read: <T>(scope: StorageScope, fn: (u: Unit) => Promise<T>) => Promise<T>;
  /** A unit with the raw handle, for statements that skip the stores. */
  readonly runSql: <T>(scope: StorageScope, fn: (u: SqlUnit) => Promise<T>) => Promise<T>;
  readonly failure: (work: Promise<unknown>) => Promise<{ kind: string; code: string }>;
  readonly setNow: (instant: Temporal.Instant) => void;
}

/**
 * Call at the top of a test file: creates the file's own database with the namespaces, the store
 * tables and a connected adapter before its tests, and empties every table before each test.
 */
export function storeHarness(databaseName: string): StoreHarness {
  let database: TestDatabase | undefined;
  let current: PostgresAdapterInstance | undefined;
  let now = stamp;
  const clock = { now: () => now };
  const adapter = (): PostgresAdapterInstance => {
    if (current === undefined) throw new Error('the store harness is used outside a test');
    return current;
  };
  const placement = (url: string): PlacementConfig => ({
    id: 'main',
    url,
    strategy: 'shared-tables',
    pool: { max: 4 },
  });
  beforeAll(async () => {
    database = await createTestDatabase(databaseName);
    await prepareNamespaces(database.adminUrl);
    await prepareStoreTables(database.adminUrl);
    current = createPostgresInstance(
      {
        clock,
        entities: (ref) => known.get(ref),
        keyWrapper: aesKeyWrapper(new Uint8Array(32).fill(9)),
      },
      placement(database.appUrl),
      testEnvironment(),
    );
    await current.connect();
  });
  afterAll(async () => {
    await current?.close(5000);
  });
  beforeEach(async () => {
    now = stamp;
    const admin = new pg.Client({ connectionString: database?.adminUrl });
    await admin.connect();
    try {
      const tables = await admin.query<{ schemaname: string; tablename: string }>(
        `select schemaname, tablename from pg_tables where schemaname in ('app', 'kw__control') and tablename <> 'kw_migrations'`,
      );
      await admin.query(
        `truncate ${tables.rows.map((table) => `${table.schemaname}.${table.tablename}`).join(', ')}`,
      );
    } finally {
      await admin.end();
    }
  });
  return {
    clock,
    adapter,
    run: async (scope, fn) =>
      adapter().unit(scope.level === 'deployment' ? controlNamespace : testNamespace, scope, fn),
    read: async (scope, fn) =>
      adapter().unit(scope.level === 'deployment' ? controlNamespace : testNamespace, scope, fn, {
        readOnly: true,
      }),
    runSql: async (scope, fn) =>
      adapter().session(
        scope.level === 'deployment' ? controlNamespace : testNamespace,
        scope,
        async (session) =>
          fn(
            sqlUnit(session, {
              deploymentId: testScopes.deploymentId,
              clock,
              entities: sqlEntityIndex((ref) => known.get(ref)),
            }),
          ),
      ),
    failure: async (work) => {
      try {
        await work;
      } catch (error) {
        if (isKeelwerkError(error)) return { kind: error.kind, code: error.code };
        throw error;
      }
      throw new Error('expected a KeelwerkError');
    },
    setNow: (instant) => {
      now = instant;
    },
  };
}
