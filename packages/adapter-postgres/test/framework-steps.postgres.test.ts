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
    expect((await stepIds(ref)).slice(0, 5)).toEqual(['0001', '0002', '0003', '0004', '0005']);
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
  expect(history.map((row) => row.id).slice(0, 5)).toEqual([
    '0001',
    '0002',
    '0003',
    '0004',
    '0005',
  ]);
  for (const row of history) expect(row.appliedAt.toString()).toBe(pinned.toString());
});

test('a root made by 0.2.0 keeps its receipt rows, and step 0006 takes insert and update from a maintenance unit', async () => {
  const old = reference('ns-v02', 'v02_receipts');
  const table = 'v02_receipts.core__command_receipt';
  const unitScope = `current_setting('keelwerk.scope', true) = 'namespace'`;
  await instance.schema.provision(old, []);
  const admin = new pg.Client({ connectionString: running.adminUrl });
  const app = new pg.Client({ connectionString: running.appUrl });
  await admin.connect();
  await app.connect();
  const policies = async (): Promise<unknown[]> =>
    (
      await admin.query(
        `select policyname as name, cmd from pg_policies where schemaname = 'v02_receipts' and tablename = 'core__command_receipt' order by policyname`,
      )
    ).rows;
  // As a maintenance unit: the number of rows an update changed, or the error code of an insert.
  const asNamespace = async (statement: string): Promise<number | string> => {
    await app.query('begin');
    try {
      await app.query(`select set_config('keelwerk.scope', 'namespace', true)`);
      return (await app.query(statement)).rowCount ?? 0;
    } catch (error) {
      return error instanceof Error && 'code' in error ? String(error.code) : 'error';
    } finally {
      await app.query('rollback');
    }
  };
  const update = `update ${table} set status = 'completed'`;
  const insert = `insert into ${table} (scope_id, id, command_id, action, fingerprint, status, api_version, transport, expires_at) values (gen_random_uuid(), gen_random_uuid(), 'c2', 'a', 'f', 'pending', 'v', 'rest', now())`;
  try {
    // The root as 0.2.0 left it: one `maintenance` policy for every command, and no row for step 0006.
    await admin.query(`
      drop policy maintenance_select on ${table};
      drop policy maintenance_delete on ${table};
      create policy maintenance on ${table} using (${unitScope}) with check (${unitScope});
      delete from v02_receipts.kw_migrations where track = '${frameworkTrack}' and id = '0006';
      insert into ${table} (scope_id, id, command_id, action, fingerprint, status, api_version, transport, expires_at)
        values (gen_random_uuid(), gen_random_uuid(), 'c1', 'a', 'f', 'pending', 'v', 'rest', now())`);
    expect(await asNamespace(update)).toBe(1);
    expect(await asNamespace(insert)).toBe(1);
    await instance.schema.provision(old, []);
    expect(await policies()).toEqual([
      { name: 'maintenance_delete', cmd: 'DELETE' },
      { name: 'maintenance_select', cmd: 'SELECT' },
      { name: 'scoped', cmd: 'ALL' },
    ]);
    expect((await admin.query(`select command_id as "commandId" from ${table}`)).rows).toEqual([
      { commandId: 'c1' },
    ]);
    expect(await asNamespace(update)).toBe(0);
    expect(await asNamespace(insert)).toBe('42501');
    expect(
      (await instance.schema.history(old))
        .filter((row) => row.track === frameworkTrack)
        .map((row) => row.id),
    ).toContain('0006');
  } finally {
    await app.end();
    await admin.end();
  }
});
