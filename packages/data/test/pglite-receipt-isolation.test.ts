import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { commandReceiptDdl } from '../src/sql/postgres/command-receipt-ddl.ts';
import { changedRows } from './support/changed-rows.ts';
import { inUnit } from './support/in-unit.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { ns } from './support/ns.ts';
import { provisionedPglite } from './support/provisioned-pglite.ts';
import { receiptSeed } from './support/receipt-seed.ts';
import { runStatement } from './support/run-statement.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';

const table = 'core__command_receipt';
const tenantC = '00000000-0000-4000-8000-0000000000c3';
let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = await provisionedPglite();
  await adapter.asOwner(async (database) => {
    for (const statement of commandReceiptDdl(ns)) await database.query(statement);
    await database.query(`grant select, insert, update, delete on ${ns}.${table} to kw_app`);
  });
  for (const id of [tenantA, tenantB]) {
    await inUnit(adapter, storageTenant(id), async (u) => runStatement(u, receiptSeed, [id]));
  }
}, 60_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

describe('the receipt table and a maintenance unit on PGlite', () => {
  test('a maintenance unit reads every receipt row', async () => {
    const seen = await inUnit(adapter, namespaceScope, async (u) =>
      runStatement(u, `select scope_id::text as id from ${ns}.${table}`),
    );
    expect(seen.rows.map((row) => row.id).sort()).toEqual([tenantA, tenantB].sort());
  });

  test('a maintenance unit cannot insert or update a receipt row, and its own scope still can', async () => {
    await expect(
      inUnit(adapter, namespaceScope, async (u) => runStatement(u, receiptSeed, [tenantC])),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      await changedRows(
        adapter,
        namespaceScope,
        `update ${ns}.${table} set status = 'completed' where scope_id = $1`,
        [tenantB],
      ),
    ).toBe(0);
    const untouched = await inUnit(adapter, storageTenant(tenantB), async (u) =>
      runStatement(u, `select status from ${ns}.${table}`),
    );
    expect(untouched.rows).toEqual([{ status: 'pending' }]);
    expect(
      await changedRows(
        adapter,
        storageTenant(tenantB),
        `update ${ns}.${table} set status = 'completed' where scope_id = $1`,
        [tenantB],
      ),
    ).toBe(1);
  });

  test("a delete without a condition in a tenant unit removes that tenant's receipts only", async () => {
    expect(
      await changedRows(adapter, storageTenant(tenantA), `delete from ${ns}.${table}`, []),
    ).toBe(1);
    const left = await inUnit(adapter, namespaceScope, async (u) =>
      runStatement(u, `select scope_id::text as id from ${ns}.${table}`),
    );
    expect(left.rows).toEqual([{ id: tenantB }]);
  });

  test('a maintenance unit deletes a receipt row', async () => {
    expect(
      await changedRows(adapter, namespaceScope, `delete from ${ns}.${table} where scope_id = $1`, [
        tenantB,
      ]),
    ).toBe(1);
  });
});
