import type { NamespaceRef } from '@keelwerk/core';
import { frameworkTrack } from '@keelwerk/data';
import { keepIdleClients } from '@keelwerk/testing/postgres';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { postgresAdapter } from '../src/postgres-adapter.ts';
import type { PostgresAdapterInstance } from '../src/postgres-adapter-instance.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { prepareNamespaces } from './support/prepare-namespaces.ts';
import type { TestDatabase } from './support/test-database.ts';
import { testEnvironment } from './support/test-environment.ts';

const pinned = Temporal.Instant.from('2020-01-01T00:00:00Z');

const reference = (id: string, root: string): NamespaceRef => ({
  id,
  placementId: 'main',
  appId: 'conformance',
  tenantId: null,
  root,
});

const m1App = reference('ns-app', 'app');
const control = reference('ns-control', 'kw__control');
const fresh = reference('ns-fresh', 'fresh_steps');

let running: TestDatabase;
let instance: PostgresAdapterInstance;

beforeAll(async () => {
  running = await createTestDatabase('framework_steps');
  await prepareNamespaces(running.adminUrl);
  instance = postgresAdapter({ ownerUrl: running.adminUrl }).create(
    {
      id: 'main',
      url: running.appUrl,
      strategy: 'shared-tables',
      pool: { max: 2, ...keepIdleClients },
    },
    { ...testEnvironment(), clock: { now: () => pinned } },
  ) as PostgresAdapterInstance;
  await instance.connect();
}, 120_000);

afterAll(async () => {
  await instance?.close(5000);
});

const stepIds = async (ref: NamespaceRef): Promise<readonly string[]> =>
  (await instance.schema.history(ref))
    .filter((row) => row.track === frameworkTrack)
    .map((row) => row.id);

test('the adapter migrates M1 roots at provision', async () => {
  expect(await stepIds(m1App)).toEqual([]);
  await instance.schema.provision(m1App, []);
  await instance.schema.provision(control, []);
  for (const ref of [m1App, control])
    expect((await stepIds(ref)).slice(0, 4)).toEqual(['0001', '0002', '0003', '0004']);
  const admin = new pg.Client({ connectionString: running.adminUrl });
  await admin.connect();
  const tables = await admin
    .query(
      `select to_regclass('app.kw_consumers') is not null as consumers, to_regclass('kw__control.kw_ledger') is not null as ledger`,
    )
    .finally(() => admin.end());
  expect(tables.rows[0]).toEqual({ consumers: true, ledger: true });
});

test('a fresh namespace provisioned by the adapter gets every step, stamped at the environment clock', async () => {
  await instance.schema.provision(fresh, []);
  const history = (await instance.schema.history(fresh)).filter(
    (row) => row.track === frameworkTrack,
  );
  expect(history.map((row) => row.id).slice(0, 4)).toEqual(['0001', '0002', '0003', '0004']);
  for (const row of history) expect(row.appliedAt.toString()).toBe(pinned.toString());
});
