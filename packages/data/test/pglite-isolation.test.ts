import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { backend } from './support/backend.ts';
import { backendScope } from './support/backend-scope.ts';
import { changedRows } from './support/changed-rows.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { inUnit } from './support/in-unit.ts';
import { insertFor } from './support/insert-for.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { ns } from './support/ns.ts';
import { provisionedPglite } from './support/provisioned-pglite.ts';
import { runStatement } from './support/run-statement.ts';
import { scopeIds } from './support/scope-ids.ts';
import { scopedTableNames } from './support/scoped-table-names.ts';
import { seedTenants } from './support/seed-tenants.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';

let adapter: PgliteAdapter;
let laneOfA = '';

beforeAll(async () => {
  adapter = await provisionedPglite();
  laneOfA = await seedTenants(adapter);
}, 60_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

describe('tenant isolation on PGlite', () => {
  test('units run as a role that cannot bypass row-level security', async () => {
    const role = await inUnit(adapter, storageTenant(tenantA), async (u) =>
      runStatement(
        u,
        'select current_user as who, rolsuper, rolbypassrls from pg_roles where rolname = current_user',
      ),
    );
    expect(role.rows[0]).toEqual({ who: 'kw_app', rolsuper: false, rolbypassrls: false });
    const forced = await adapter.asOwner(async (database) =>
      database.query<{ n: string }>(
        `select count(*)::text as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
         where s.nspname = $1 and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity`,
        [ns],
      ),
    );
    expect(Number(forced.rows[0]?.n)).toBe(scopedTableNames.length);
  });

  test.each(scopedTableNames)('%s: a tenant sees only its own rows', async (table) => {
    for (const mine of [tenantA, tenantB]) {
      const ids = await scopeIds(adapter, storageTenant(mine), table);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(id).toBe(mine);
    }
  });

  test.each(scopedTableNames)(
    "%s: a tenant can neither change nor insert another tenant's rows",
    async (table) => {
      const scope = storageTenant(tenantA);
      const update = `update ${ns}.${table} set scope_id = scope_id where scope_id = $1`;
      expect(await changedRows(adapter, scope, update, [tenantB])).toBe(0);
      const remove = `delete from ${ns}.${table} where scope_id = $1`;
      expect(await changedRows(adapter, scope, remove, [tenantB])).toBe(0);
      const insert = insertFor(table, tenantB, laneOfA);
      await expect(
        inUnit(adapter, scope, async (u) => runStatement(u, insert.text, insert.values)),
      ).rejects.toMatchObject({ code: '42501' });
    },
  );

  test('kw_events is append-only for the application role', async () => {
    await expect(
      inUnit(adapter, storageTenant(tenantA), async (u) =>
        runStatement(u, `update ${ns}.kw_events set scope_id = scope_id`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inUnit(adapter, storageTenant(tenantA), async (u) =>
        runStatement(u, `delete from ${ns}.kw_events`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  describe.each([
    ['backend', backendScope],
    ['deployment', deploymentScope],
  ] as const)('a %s-scope unit', (_name, scope) => {
    test.each(scopedTableNames)('%s: sees no tenant row and changes none', async (table) => {
      const ids = await scopeIds(adapter, scope, table);
      expect(ids.filter((id) => id === tenantA || id === tenantB)).toEqual([]);
      const tenants = [tenantA, tenantB];
      expect(
        await changedRows(
          adapter,
          scope,
          `update ${ns}.${table} set scope_id = scope_id where scope_id = any ($1::uuid[])`,
          [tenants],
        ),
      ).toBe(0);
      expect(
        await changedRows(
          adapter,
          scope,
          `delete from ${ns}.${table} where scope_id = any ($1::uuid[])`,
          [tenants],
        ),
      ).toBe(0);
      const insert = insertFor(table, tenantA, laneOfA);
      await expect(
        inUnit(adapter, scope, async (u) => runStatement(u, insert.text, insert.values)),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  test('a backend-scope unit reads and writes its own rows', async () => {
    expect(await scopeIds(adapter, backendScope, 'kw_usage')).toEqual([backend]);
  });

  test('a backend or namespace unit after a tenant unit sees what its scope admits (decision 111)', async () => {
    await inUnit(adapter, storageTenant(tenantA), async (u) =>
      runStatement(u, `select 1 from ${ns}.kw_events`),
    );
    const outside = await adapter.asOwner(async (database) =>
      database.query<{ value: string | null }>(
        `select current_setting('keelwerk.tenant_id', true) as value`,
      ),
    );
    expect(outside.rows[0]?.value).toBe('');
    const backendSeen = await inUnit(adapter, backendScope, async (u) =>
      runStatement(u, `select 1 from ${ns}.kw_events`),
    );
    expect(backendSeen.rows).toHaveLength(0);
    const namespaceSeen = await inUnit(adapter, namespaceScope, async (u) =>
      runStatement(u, `select 1 from ${ns}.kw_events`),
    );
    expect(namespaceSeen.rows).toHaveLength(2);
  });
});
