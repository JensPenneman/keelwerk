import type { NamespaceRef } from '@keelwerk/core';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { postgresAdapter } from '../src/postgres-adapter.ts';
import type { PostgresAdapterInstance } from '../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { prepareNamespaces } from './support/prepare-namespaces.ts';
import type { TestDatabase } from './support/test-database.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testScopes } from './support/test-scopes.ts';

const pinned = Temporal.Instant.from('2020-01-01T00:00:00Z');

const namespace: NamespaceRef = {
  id: 'ns-streams',
  placementId: 'main',
  appId: 'conformance',
  tenantId: null,
  root: 'stream_records',
};

let running: TestDatabase;
let instance: PostgresAdapterInstance;

beforeAll(async () => {
  running = await createTestDatabase('stream_records');
  await prepareNamespaces(running.adminUrl);
  // No `clock` option: the clock of the environment is the one the adapter reads.
  instance = postgresAdapter({ ownerUrl: running.adminUrl }).create(
    { id: 'main', url: running.appUrl, strategy: 'shared-tables', pool: { max: 2 } },
    { ...testEnvironment(), clock: { now: () => pinned } },
  ) as PostgresAdapterInstance;
  await instance.connect();
  await instance.schema.provision(namespace, []);
}, 120_000);

afterAll(async () => {
  await instance?.close(5000);
});

async function asOwner(text: string): Promise<readonly Record<string, unknown>[]> {
  const owner = new pg.Client({ connectionString: running.adminUrl });
  await owner.connect();
  try {
    return (await owner.query(text)).rows;
  } finally {
    await owner.end();
  }
}

const append = (key: string, records: readonly unknown[]) =>
  instance.unit(namespace, testScopes.scopeA, (u) => u.streams.append('conf.log', key, records));

test('data holds the record under the one member record', async () => {
  await append('golden', [{ line: 'a' }]);
  expect(
    await asOwner(`select data from stream_records.kw_stream_records where key = 'golden'`),
  ).toEqual([{ data: { record: { line: 'a' } } }]);
});

test('seq is drawn from the kw_serials row stream:<stream>, seq, canonical JSON of the key', async () => {
  await append('counted', [{ n: 1 }, { n: 2 }]);
  await append('counted', [{ n: 3 }]);
  expect(
    await asOwner(
      `select seq::text as seq from stream_records.kw_stream_records where key = 'counted' order by seq`,
    ),
  ).toEqual([{ seq: '1' }, { seq: '2' }, { seq: '3' }]);
  expect(
    await asOwner(
      `select next::text as next from stream_records.kw_serials
       where entity = 'stream:conf.log' and field = 'seq' and partition = '["counted"]'`,
    ),
  ).toEqual([{ next: '4' }]);
});

test("at is the adapter clock's instant, never the database's", async () => {
  await append('timed', [{ line: 'a' }]);
  expect(
    await asOwner(
      `select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
       from stream_records.kw_stream_records where key = 'timed'`,
    ),
  ).toEqual([{ at: '2020-01-01T00:00:00.000Z' }]);
});

test('a record stored without the record member is refused as internal on read', async () => {
  await append('foreign', [{ line: 'a' }]);
  await asOwner(
    `update stream_records.kw_stream_records set data = '{"offload": {}}'::jsonb where key = 'foreign'`,
  );
  await expect(
    instance.unit(namespace, testScopes.scopeA, (u) =>
      u.streams.read('conf.log', 'foreign', null, 10),
    ),
  ).rejects.toMatchObject({ kind: 'internal' });
});
