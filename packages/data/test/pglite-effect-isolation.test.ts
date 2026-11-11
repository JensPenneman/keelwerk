import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { effectRecordDdl } from '../src/sql/postgres/effect-record-ddl.ts';
import { backendScope } from './support/backend-scope.ts';
import { changedRows } from './support/changed-rows.ts';
import { effectSeed } from './support/effect-seed.ts';
import { inUnit } from './support/in-unit.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { ns } from './support/ns.ts';
import { provisionedPglite } from './support/provisioned-pglite.ts';
import { runStatement } from './support/run-statement.ts';
import { scopeIds } from './support/scope-ids.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';

const table = 'core__effect';
const tenantC = '00000000-0000-4000-8000-0000000000c3';
let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = await provisionedPglite();
  await adapter.asOwner(async (database) => {
    for (const statement of effectRecordDdl(ns)) await database.query(statement);
    await database.query(`grant select, insert, update, delete on ${ns}.${table} to kw_app`);
  });
  for (const id of [tenantA, tenantB]) {
    await inUnit(adapter, storageTenant(id), async (u) => runStatement(u, effectSeed, [id]));
  }
}, 60_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

describe('core.effect rows of two tenants on PGlite (reviewer check 7)', () => {
  test('a tenant finds only its own effect rows', async () => {
    for (const mine of [tenantA, tenantB]) {
      expect(await scopeIds(adapter, storageTenant(mine), table)).toEqual([mine]);
    }
  });

  test("a tenant can neither change, delete nor insert another tenant's effect rows", async () => {
    const scope = storageTenant(tenantA);
    expect(
      await changedRows(
        adapter,
        scope,
        `update ${ns}.${table} set status = 'failed' where scope_id = $1`,
        [tenantB],
      ),
    ).toBe(0);
    expect(
      await changedRows(adapter, scope, `delete from ${ns}.${table} where scope_id = $1`, [
        tenantB,
      ]),
    ).toBe(0);
    await expect(
      inUnit(adapter, scope, async (u) => runStatement(u, effectSeed, [tenantB])),
    ).rejects.toMatchObject({ code: '42501' });
    const untouched = await inUnit(adapter, storageTenant(tenantB), async (u) =>
      runStatement(u, `select status from ${ns}.${table}`),
    );
    expect(untouched.rows).toEqual([{ status: 'requested' }]);
  });

  test('a backend-scope unit sees no tenant row, and a maintenance unit sees both', async () => {
    expect(await scopeIds(adapter, backendScope, table)).toEqual([]);
    const seen = await inUnit(adapter, namespaceScope, async (u) =>
      runStatement(u, `select scope_id::text as id from ${ns}.${table}`),
    );
    expect(seen.rows.map((row) => row.id).sort()).toEqual([tenantA, tenantB].sort());
  });

  test('a maintenance unit reads and deletes effect rows but cannot insert or update them', async () => {
    await expect(
      inUnit(adapter, namespaceScope, async (u) => runStatement(u, effectSeed, [tenantC])),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      await changedRows(
        adapter,
        namespaceScope,
        `update ${ns}.${table} set status = 'failed' where scope_id = $1`,
        [tenantB],
      ),
    ).toBe(0);
    expect(
      await changedRows(adapter, namespaceScope, `delete from ${ns}.${table} where scope_id = $1`, [
        tenantB,
      ]),
    ).toBe(1);
  });
});
