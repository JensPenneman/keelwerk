import type { Receipt } from '@keelwerk/core';
import { commandReceiptUuid } from '@keelwerk/core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type PgliteAdapter, pgliteSchemaConnection } from '../src/pglite/index.ts';
import { withCommandReceipts } from '../src/sql/postgres/with-command-receipts.ts';
import { backend } from './support/backend.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { id } from './support/id.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { runStatement } from './support/run-statement.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';

let adapter: PgliteAdapter;
const scope = storageTenant(tenantA);
const receiptType = 'core.commandReceipt';
const later = `now() + interval '1 day'`;

/** The stream of the change records of the receipt of command `c<n>` in tenant A. */
const streamOf = (n: number): string => commandReceiptUuid(tenantA, `c${n}`);

function receiptOf(commandId: string): Receipt {
  return {
    commandId,
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
  };
}

/** Appends records to a stream, in the application role's unit, as the commit path does. */
async function record(
  type: string,
  stream: string,
  versions: readonly number[],
  options: { readonly transient?: boolean; readonly position: number },
): Promise<void> {
  await adapter.unit(exampleNamespace, scope, async (unit) => {
    for (const [index, version] of versions.entries()) {
      await runStatement(
        unit,
        `insert into example.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
          event_id, name, schema_version, shape_id, data, meta, hlc, recorded_at, transient)
          values ($1, $2, $3, $4, $5, $6, $7, 'created', 1, '\\x00', '{}', '{}', 'h', now(), $8)`,
        [
          tenantA,
          String(options.position + index),
          backend,
          type,
          stream,
          String(version),
          id(options.position + index + 1000),
          options.transient ?? true,
        ],
      );
    }
  });
}

const purge = (list: string, extra = later, limit = 10) =>
  adapter.unit(exampleNamespace, scope, async (unit) =>
    runStatement(
      unit,
      `select removed, more, records from example.kw_purge_transient(${extra}, ${limit}, ${list})`,
    ),
  );

const versionsLeft = async (stream: string): Promise<readonly number[]> => {
  const left = await adapter.asOwner(async (database) =>
    database.query<{ v: number }>(
      `select stream_version as v from example.kw_events where stream_id = $1 order by 1`,
      [stream],
    ),
  );
  return left.rows.map((row) => row.v);
};

beforeAll(async () => {
  adapter = await openClockedPglite();
  // Every framework step, as a deployment is migrated: the application role gets the purge
  // function. The receipt table is provisioned with it.
  await withCommandReceipts(
    adapter.schema,
    pgliteSchemaConnection(adapter.asOwner),
    'kw_app',
  ).provision(exampleNamespace, []);
  await adapter.unit(exampleNamespace, scope, async (unit) => {
    await unit.receipts.put(receiptOf('c1'));
    await unit.receipts.put(receiptOf('c3'));
  });
  await record(receiptType, streamOf(1), [1, 2, 3], { position: 1 });
  await record('app.note', id(2), [1, 2], { position: 10, transient: false });
}, 120_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

test('in a migrated root the application role can update and delete nothing in kw_events', async () => {
  for (const text of [
    `update example.kw_events set scope_id = scope_id`,
    `delete from example.kw_events where transient`,
    `delete from example.kw_events where not transient`,
  ]) {
    await expect(
      adapter.unit(exampleNamespace, scope, async (unit) => runStatement(unit, text)),
    ).rejects.toMatchObject({ code: '42501' });
  }
});

test('in a migrated root the function removes the older records of a receipt stream but its newest and every other', async () => {
  expect((await purge(`array[]::text[]`)).rows[0]).toMatchObject({
    removed: 0,
    more: false,
    records: [],
  });
  const removed = await purge(`array['${receiptType}']`);
  // `records` is the [data, before, meta] of each deleted row, which the adapter measures to give the bytes back.
  expect(removed.rows[0]).toMatchObject({
    removed: 2,
    more: false,
    records: [
      [{}, null, {}],
      [{}, null, {}],
    ],
  });
  expect(await versionsLeft(streamOf(1))).toEqual([3]);
  expect(await versionsLeft(id(2))).toEqual([1, 2]);
});

test('in a migrated root the function refuses a namespace-scope unit, a limit outside its bounds and a null instant', async () => {
  await expect(
    adapter.unit(exampleNamespace, { level: 'namespace', reason: 'purge test' }, async (unit) =>
      runStatement(
        unit,
        `select example.kw_purge_transient(${later}, 10, array['${receiptType}'])`,
      ),
    ),
  ).rejects.toMatchObject({ code: '42501' });
  for (const limit of [0, 100_001]) {
    await expect(purge(`array['${receiptType}']`, later, limit)).rejects.toMatchObject({
      code: '22023',
    });
  }
  await expect(purge(`array['${receiptType}']`, 'null::timestamptz')).rejects.toMatchObject({
    code: '22023',
  });
});

test('in a migrated root a null list is refused and an empty list removes nothing', async () => {
  await expect(purge('null::text[]')).rejects.toMatchObject({ code: '22023' });
  const answer = await purge('array[]::text[]');
  expect(answer.rows[0]).toMatchObject({ removed: 0, more: false });
});

test('a session of the application role cannot purge the history of a state entity by naming its type', async () => {
  // What a leaked credential would run: the records of a state entity, older than anything, with
  // the newest of each stream forged by the same role. The stored function refuses every list
  // that names a type but the receipts' and deletes nothing.
  await record('shop.order', id(5), [1, 2, 3], { position: 20 });
  await record('shop.order', id(6), [1], { position: 30 });
  const before = await adapter.asOwner(async (database) =>
    database.query<{ n: number }>(`select count(*)::int as n from example.kw_events`),
  );
  for (const list of [
    `array['shop.order']`,
    `array['${receiptType}', 'shop.order']`,
    `array[null]::text[]`,
  ]) {
    await expect(purge(list, `'infinity'::timestamptz`, 100_000)).rejects.toMatchObject({
      code: '42501',
    });
  }
  const after = await adapter.asOwner(async (database) =>
    database.query<{ n: number }>(`select count(*)::int as n from example.kw_events`),
  );
  expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
});

test('a receipt stream keeps its newest record while its receipt row exists and loses it when the row is gone', async () => {
  await record(receiptType, streamOf(1), [4, 5], { position: 40 });
  await record(receiptType, streamOf(2), [1, 2], { position: 50 });
  await record(receiptType, streamOf(3), [1, 2], { position: 60 });
  // Stream 1 and 3 have a receipt, stream 2 has none: its two records are candidates, and so is
  // each older record of the others.
  const answer = await purge(`array['${receiptType}']`);
  expect(answer.rows[0]).toMatchObject({ removed: 5, more: false });
  expect(await versionsLeft(streamOf(1))).toEqual([5]);
  expect(await versionsLeft(streamOf(2))).toEqual([]);
  expect(await versionsLeft(streamOf(3))).toEqual([2]);
  await adapter.unit(exampleNamespace, scope, async (unit) =>
    runStatement(unit, `delete from example.core__command_receipt where id = $1`, [streamOf(3)]),
  );
  expect((await purge(`array['${receiptType}']`)).rows[0]).toMatchObject({
    removed: 1,
    more: false,
  });
  expect(await versionsLeft(streamOf(3))).toEqual([]);
});

test('a plain owner role makes the function and the forced policies keep their work', async () => {
  await adapter.asOwner(async (database) => {
    await database.exec(
      `create role plain_owner nosuperuser nobypassrls nocreatedb nocreaterole nologin`,
    );
  });
  // The function of this root is owned by the migrating role; run it again as an ordinary owner.
  await adapter.asOwner(async (database) => {
    await database.exec(
      `alter function example.kw_purge_transient(timestamptz, integer, text[]) owner to plain_owner`,
    );
    await database.exec(`alter table example.kw_events owner to plain_owner`);
    await database.exec(`alter table example.core__command_receipt owner to plain_owner`);
    await database.exec(`grant usage on schema example to plain_owner`);
  });
  await record(receiptType, streamOf(1), [6, 7], { position: 70 });
  expect((await purge(`array[]::text[]`)).rows[0]).toMatchObject({
    removed: 0,
    more: false,
    records: [],
  });
  const removed = await purge(`array['${receiptType}']`);
  // `records` is the [data, before, meta] of each deleted row, which the adapter measures to give the bytes back.
  expect(removed.rows[0]).toMatchObject({
    removed: 2,
    more: false,
    records: [
      [{}, null, {}],
      [{}, null, {}],
    ],
  });
  expect(await versionsLeft(streamOf(1))).toEqual([7]);
});
