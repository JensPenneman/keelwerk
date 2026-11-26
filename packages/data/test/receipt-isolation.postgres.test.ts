import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { commandReceiptDdl } from '../src/sql/postgres/command-receipt-ddl.ts';
import { applyFrameworkTables } from './support/apply-framework-tables.ts';
import { asNamespace } from './support/as-namespace.ts';
import { asTenant } from './support/as-tenant.ts';
import { connect } from './support/connect.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { ns } from './support/ns.ts';
import { receiptSeed } from './support/receipt-seed.ts';
import type { Settings } from './support/settings.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';
import { unit } from './support/unit.ts';

const table = 'core__command_receipt';
const tenantC = '00000000-0000-4000-8000-0000000000c3';
let admin: Client;
let app: Client;

/** Rows a statement changed; a statement the role has no privilege for changed none. */
async function changed(settings: Settings, text: string, values: unknown[]): Promise<number> {
  try {
    return (await unit(app, settings, async () => app.query(text, values))).rowCount ?? 0;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '42501') return 0;
    throw error;
  }
}

beforeAll(async () => {
  const postgres = await createTestDatabase('receipt_isolation');
  admin = await connect(postgres.adminUrl);
  await applyFrameworkTables(admin);
  for (const statement of commandReceiptDdl(ns)) await admin.query(statement);
  await admin.query(`grant select, insert, update, delete on ${ns}.${table} to kw_app`);
  app = await connect(postgres.appUrl);
  for (const id of [tenantA, tenantB]) {
    await unit(app, asTenant(id), async () => app.query(receiptSeed, [id]));
  }
}, 120_000);

afterAll(async () => {
  await app?.end();
  await admin?.end();
});

describe('the receipt table and a maintenance unit on PostgreSQL', () => {
  test('a maintenance unit reads every receipt row', async () => {
    const seen = await unit(
      app,
      asNamespace,
      async () =>
        (await app.query<{ id: string }>(`select scope_id::text as id from ${ns}.${table}`)).rows,
    );
    expect(seen.map((row) => row.id).sort()).toEqual([tenantA, tenantB].sort());
  });

  test('a maintenance unit cannot insert or update a receipt row, and its own scope still can', async () => {
    await expect(
      unit(app, asNamespace, async () => app.query(receiptSeed, [tenantC])),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      await changed(
        asNamespace,
        `update ${ns}.${table} set status = 'completed' where scope_id = $1`,
        [tenantB],
      ),
    ).toBe(0);
    const status = await unit(
      app,
      asTenant(tenantB),
      async () => (await app.query(`select status from ${ns}.${table}`)).rows,
    );
    expect(status).toEqual([{ status: 'pending' }]);
    expect(
      await changed(
        asTenant(tenantB),
        `update ${ns}.${table} set status = 'completed' where scope_id = $1`,
        [tenantB],
      ),
    ).toBe(1);
  });

  test("a delete without a condition in a tenant unit removes that tenant's receipts only", async () => {
    expect(await changed(asTenant(tenantA), `delete from ${ns}.${table}`, [])).toBe(1);
    const left = await unit(
      app,
      asNamespace,
      async () =>
        (await app.query<{ id: string }>(`select scope_id::text as id from ${ns}.${table}`)).rows,
    );
    expect(left).toEqual([{ id: tenantB }]);
  });

  test('a maintenance unit deletes a receipt row', async () => {
    expect(
      await changed(asNamespace, `delete from ${ns}.${table} where scope_id = $1`, [tenantB]),
    ).toBe(1);
  });
});
