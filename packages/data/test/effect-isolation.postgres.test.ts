import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { effectRecordDdl } from '../src/sql/postgres/effect-record-ddl.ts';
import { applyFrameworkTables } from './support/apply-framework-tables.ts';
import { asBackend } from './support/as-backend.ts';
import { asNamespace } from './support/as-namespace.ts';
import { asTenant } from './support/as-tenant.ts';
import { connect } from './support/connect.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { effectSeed } from './support/effect-seed.ts';
import { ns } from './support/ns.ts';
import type { Settings } from './support/settings.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';
import { unit } from './support/unit.ts';

const table = 'core__effect';
let admin: Client;
let app: Client;

const idsSeenBy = async (settings: Settings): Promise<string[]> =>
  unit(app, settings, async () =>
    (await app.query<{ id: string }>(`select scope_id::text as id from ${ns}.${table}`)).rows.map(
      (row) => row.id,
    ),
  );

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
  const postgres = await createTestDatabase('effect_isolation');
  admin = await connect(postgres.adminUrl);
  await applyFrameworkTables(admin);
  for (const statement of effectRecordDdl(ns)) await admin.query(statement);
  await admin.query(`grant select, insert, update, delete on ${ns}.${table} to kw_app`);
  app = await connect(postgres.appUrl);
  for (const id of [tenantA, tenantB]) {
    await unit(app, asTenant(id), async () => app.query(effectSeed, [id]));
  }
}, 120_000);

afterAll(async () => {
  await app?.end();
  await admin?.end();
});

describe('core.effect rows of two tenants on PostgreSQL (reviewer check 7)', () => {
  test('a tenant finds only its own effect rows', async () => {
    expect(await idsSeenBy(asTenant(tenantA))).toEqual([tenantA]);
    expect(await idsSeenBy(asTenant(tenantB))).toEqual([tenantB]);
  });

  test("a tenant can neither change, delete nor insert another tenant's effect rows", async () => {
    const mine = asTenant(tenantA);
    expect(
      await changed(mine, `update ${ns}.${table} set status = 'failed' where scope_id = $1`, [
        tenantB,
      ]),
    ).toBe(0);
    expect(await changed(mine, `delete from ${ns}.${table} where scope_id = $1`, [tenantB])).toBe(
      0,
    );
    await expect(
      unit(app, mine, async () => app.query(effectSeed, [tenantB])),
    ).rejects.toMatchObject({
      code: '42501',
    });
    const status = await unit(
      app,
      asTenant(tenantB),
      async () => (await app.query(`select status from ${ns}.${table}`)).rows,
    );
    expect(status).toEqual([{ status: 'requested' }]);
  });

  test('a backend-scope unit sees no tenant row, and a maintenance unit sees both', async () => {
    expect(await idsSeenBy(asBackend)).toEqual([]);
    expect((await idsSeenBy(asNamespace)).sort()).toEqual([tenantA, tenantB].sort());
  });
});
