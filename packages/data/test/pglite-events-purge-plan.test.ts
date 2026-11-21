import { afterAll, beforeAll, expect, test } from 'vitest';
import { type PgliteAdapter, pgliteSchemaConnection } from '../src/pglite/index.ts';
import { transientPurgeBatchSql } from '../src/sql/postgres/transient-purge-batch-sql.ts';
import { withCommandReceipts } from '../src/sql/postgres/with-command-receipts.ts';
import { backend } from './support/backend.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';

let adapter: PgliteAdapter;

/** The statement of the function over the three parameters it reads as variables; `into` is the one clause only PL/pgSQL has. */
const prepared = (receipts: boolean, kind: 'batch' | 'more'): string => {
  const sql = transientPurgeBatchSql('example', receipts)
    [kind].replace(' into removed, records', '')
    .replaceAll(/\bunit_scope\b/g, '$1::uuid')
    .replaceAll(/\bcutoff\b/g, '$2::timestamptz')
    .replaceAll(/\bmax_rows\b/g, '$3::integer');
  return `prepare purge_${kind}(uuid, timestamptz, integer) as ${sql}`;
};

/** The plan of the statement, with sequential scans off: whether an index can serve it at all. */
async function plan(
  receipts: boolean,
  kind: 'batch' | 'more',
  mode: 'force_custom_plan' | 'force_generic_plan',
): Promise<string> {
  return adapter.asOwner(async (database) => {
    await database.exec(`set enable_seqscan = off; set plan_cache_mode = ${mode}`);
    await database.exec(`deallocate all`);
    await database.exec(prepared(receipts, kind));
    const answered = await database.query<Record<string, string>>(
      `explain execute purge_${kind}('${tenantA}', now() + interval '1 day', 1000)`,
    );
    await database.exec(`reset enable_seqscan; reset plan_cache_mode; deallocate all`);
    return answered.rows.map((row) => Object.values(row).join(' ')).join('\n');
  });
}

beforeAll(async () => {
  adapter = await openClockedPglite();
  await withCommandReceipts(
    adapter.schema,
    pgliteSchemaConnection(adapter.asOwner),
    'kw_app',
  ).provision(exampleNamespace, []);
  // Receipt streams with two change records each, and state records that are never candidates.
  await adapter.asOwner(async (database) => {
    await database.exec(
      `insert into example.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
         event_id, name, schema_version, shape_id, data, meta, hlc, recorded_at, transient)
       select '${tenantA}', n, '${backend}', 'core.commandReceipt', gen_random_uuid(), 1,
         gen_random_uuid(), 'created', 1, '\\x00', '{}', '{}', 'h', now() - interval '10 days' + n * interval '1 second', true
       from generate_series(1, 6000) as n;
       insert into example.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
         event_id, name, schema_version, shape_id, data, meta, hlc, recorded_at, transient)
       select scope_id, position + 100000, backend_id, stream_type, stream_id, 2,
         gen_random_uuid(), 'changed', 1, '\\x00', '{}', '{}', 'h', recorded_at, true
       from example.kw_events;
       insert into example.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
         event_id, name, schema_version, shape_id, data, meta, hlc, recorded_at, transient)
       select '${tenantA}', n + 300000, '${backend}', 'app.state', gen_random_uuid(), 1,
         gen_random_uuid(), 'created', 1, '\\x00', '{}', '{}', 'h', now() - interval '10 days', true
       from generate_series(1, 3000) as n;
       analyze example.kw_events;`,
    );
  });
  // Receipts of the scope, so that the planner has a table to choose an index of.
  await adapter.unit(exampleNamespace, storageTenant(tenantA), async (unit) => {
    await unit.receipts.put({
      commandId: 'template',
      action: 'app.note.set',
      fingerprint: 'f1',
      principal: null,
      principalResolver: null,
      principalId: null,
      status: 'completed',
      outcome: { ok: true, value: 1, effects: [] },
      apiVersion: '2026-01-01',
      request: { transport: 'rest', remoteAddress: null, userAgent: null },
      clientId: null,
      clientSeq: null,
      expiresAt: Temporal.Instant.from('2099-01-01T00:00:00Z'),
    });
  });
  await adapter.asOwner(async (database) => {
    const found = await database.query<{ name: string }>(
      `select column_name as name from information_schema.columns
       where table_schema = 'example' and table_name = 'core__command_receipt' order by ordinal_position`,
    );
    const columns = found.rows.map((row) => row.name);
    const values = columns.map((column) =>
      column === 'id' ? 'gen_random_uuid()' : column === 'command_id' ? `'c' || n` : `t.${column}`,
    );
    await database.exec(
      `insert into example.core__command_receipt (${columns.join(', ')})
       select ${values.join(', ')} from generate_series(1, 6000) as n cross join example.core__command_receipt as t;
       analyze example.core__command_receipt;`,
    );
  });
}, 120_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

test.each([
  ['with a receipt table', true],
  ['without a receipt table', false],
])(
  'the function over a root %s walks the partial index in order, probes by key and stops at the limit',
  async (_name, receipts) => {
    for (const mode of ['force_custom_plan', 'force_generic_plan'] as const) {
      for (const kind of ['batch', 'more'] as const) {
        const text = await plan(receipts, kind, mode);
        // The candidates come out of the partial index in the order of the batch: no sort, no hash
        // over the scope, no scan of the table, whatever the plan cache decided.
        expect(text, `${mode} ${kind}`).toContain('Index Scan using kw_events_transient');
        expect(text, `${mode} ${kind}`).not.toMatch(/Seq Scan|Sort|Hash|Bitmap|Merge Join/);
        // Each candidate is probed for a newer record, and for its receipt, through a unique key.
        expect(text, `${mode} ${kind}`).toContain(
          'Index Only Scan using kw_events_scope_id_stream_type_stream_id_stream_version_key',
        );
        if (receipts)
          expect(text, `${mode} ${kind}`).toContain(
            'Index Only Scan using core__command_receipt_pkey',
          );
        // The delete finds its rows by primary key, not by joining the scope.
        if (kind === 'batch')
          expect(text, `${mode} ${kind}`).toContain('Index Scan using kw_events_pkey');
      }
    }
  },
);

test('the receipt probe reads the receipt of the stream, so a purge over many receipts does not scan them', async () => {
  const text = await plan(true, 'batch', 'force_generic_plan');
  expect(text).not.toContain('core__command_receipt_client');
});
