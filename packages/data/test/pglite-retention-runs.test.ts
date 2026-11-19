import type { RetentionRun } from '@keelwerk/core';
import { retentionRunCases } from '@keelwerk/testing';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { listRetentionRunsStatement } from '../src/sql/postgres/list-retention-runs-statement.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { storeControlNamespace } from './support/store-control-namespace.ts';

let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = await openClockedPglite();
  await adapter.schema.provision(storeControlNamespace, []);
}, 120_000);

beforeEach(async () => {
  await adapter.asOwner(async (database) =>
    database.exec(`truncate "${storeControlNamespace.root}".kw_retention_runs`),
  );
});

afterAll(async () => {
  await adapter.close(1000);
}, 60_000);

// The same cases as the conformance suite and the PostgreSQL test, on the real control root.
retentionRunCases(
  {
    run: (scope, fn) => adapter.unit(storeControlNamespace, scope, fn),
    read: (scope, fn) => adapter.unit(storeControlNamespace, scope, fn, { readOnly: true }),
    deploymentId: '00000000-0000-4000-8000-000000000d01',
  },
  {
    table: true,
    ownerInsert: async (row) => {
      await adapter.asOwner(async (database) =>
        database.query(
          `insert into "${storeControlNamespace.root}".kw_retention_runs (run_id, started_at, ended_at, backend_id, tenant_id, rule, removed, horizons)
           values ($1, now(), now(), $2, $3, '{"rules":[]}', '{}', '{}')`,
          [row.runId, row.backendId, row.tenantId],
        ),
      );
    },
  },
);

const run: RetentionRun = {
  runId: '01952f3e-7c1a-7b2d-8e4f-3a5b6c7d8e9f',
  startedAt: Temporal.Instant.from('2026-11-18T03:00:00.000Z'),
  endedAt: Temporal.Instant.from('2026-11-18T03:00:02.500Z'),
  namespaceId: 'ns-app',
  backendId: '00000000-0000-4000-8000-0000000000b1',
  tenantId: '00000000-0000-4000-8000-0000000000a1',
  outcome: 'complete',
  error: null,
  rule: {
    rules: [
      { kind: 'receipts', olderThan: null },
      { kind: 'transientRecords', olderThan: 'P7D' },
      { kind: 'jobHistory', olderThan: 'P7D' },
      { kind: 'streamTickets', olderThan: 'P1D' },
      { kind: 'streamRecords', stream: 'library.book', maxAge: 'P1D' },
    ],
  },
  removed: {
    receipts: 3,
    valueKeys: 1,
    transientRecords: 12,
    jobHistory: 40,
    streamTickets: 2,
    streamRecords: { 'library.book': 5 },
  },
  horizons: {
    receipts: '2026-11-18T03:00:00.000Z',
    transientRecords: '2026-11-11T03:00:00.000Z',
    jobHistory: '2026-11-11T03:00:00.000Z',
    streamTickets: '2026-11-17T03:00:00.000Z',
  },
};

test('a run is stored as this row, the stored format', async () => {
  await adapter.unit(storeControlNamespace, deploymentScope, async (unit) =>
    unit.retentionRuns?.append(run),
  );
  const rows = await adapter.asOwner(async (database) =>
    database.query<{ row: unknown }>(
      `select to_jsonb(r) as row from "${storeControlNamespace.root}".kw_retention_runs r`,
    ),
  );
  await expect(`${JSON.stringify(rows.rows[0]?.row, null, 2)}\n`).toMatchFileSnapshot(
    './golden/retention-run.json',
  );
});

const failed: RetentionRun = {
  ...run,
  runId: '01952f3e-7c1a-7b2d-8e4f-3a5b6c7d8ea0',
  backendId: '00000000-0000-4000-8000-0000000000d1',
  tenantId: null,
  outcome: 'failed',
  error: { kind: 'unavailable', code: 'core.lock_timeout' },
  rule: {
    rules: [
      { kind: 'receipts', olderThan: null },
      { kind: 'transientRecords', olderThan: 'P7D' },
    ],
  },
  removed: { receipts: 0, valueKeys: 0, transientRecords: 12 },
  horizons: { receipts: '2026-11-18T03:00:00.000Z' },
};

test('a failed run of the deployment scope is stored as this row, the stored format', async () => {
  await adapter.unit(storeControlNamespace, deploymentScope, async (unit) =>
    unit.retentionRuns?.append(failed),
  );
  const rows = await adapter.asOwner(async (database) =>
    database.query<{ row: unknown }>(
      `select to_jsonb(r) as row from "${storeControlNamespace.root}".kw_retention_runs r`,
    ),
  );
  await expect(`${JSON.stringify(rows.rows[0]?.row, null, 2)}\n`).toMatchFileSnapshot(
    './golden/retention-run-failed.json',
  );
});

test('an outcome other than complete, or none, reads as stored, and a column left empty reads null', async () => {
  await adapter.unit(storeControlNamespace, deploymentScope, async (unit) =>
    unit.retentionRuns?.append(run),
  );
  await adapter.asOwner(async (database) =>
    database.exec(`update "${storeControlNamespace.root}".kw_retention_runs set outcome = 'later'`),
  );
  const read = async () =>
    adapter.unit(
      storeControlNamespace,
      deploymentScope,
      async (unit) =>
        unit.retentionRuns?.list({ backendId: run.backendId, tenantId: run.tenantId, limit: 5 }),
      { readOnly: true },
    );
  expect((await read())?.map((row) => row.outcome)).toEqual(['later']);
  await adapter.asOwner(async (database) =>
    database.exec(
      `update "${storeControlNamespace.root}".kw_retention_runs set outcome = null, namespace_id = null`,
    ),
  );
  const [row] = (await read()) ?? [];
  expect([row?.outcome, row?.namespaceId]).toEqual([null, null]);
});

test('listing the runs of a scope uses the index of the table, for a tenant and for any other scope', async () => {
  const backendId = '00000000-0000-4000-8000-0000000000b1';
  const tenantId = '00000000-0000-4000-8000-0000000000a1';
  for (const scope of [tenantId, null]) {
    const statement = listRetentionRunsStatement(storeControlNamespace.root, 'run_id', {
      backendId,
      tenantId: scope,
      limit: 5,
    });
    // A table this small is read in full whatever the index is; the plan with sequential scans
    // off shows whether the index can serve the statement at all.
    const plan = await adapter.asOwner(async (database) => {
      await database.exec('set enable_seqscan = off');
      const answered = await database.query<Record<string, string>>(
        `explain ${statement.sql.replaceAll(/\$(\d)::(\w+)/g, (_, n) => {
          const value = statement.parameters[Number(n) - 1];
          return typeof value === 'number' ? String(value) : `'${String(value)}'`;
        })}`,
      );
      await database.exec('reset enable_seqscan');
      return answered.rows.map((row) => Object.values(row).join(' ')).join('\n');
    });
    expect(plan).toContain('kw_retention_runs_scope');
    expect(plan).toContain(scope === null ? 'tenant_id IS NULL' : 'tenant_id = ');
  }
});
