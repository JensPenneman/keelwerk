import type { StorageScope } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { backendScope } from './support/backend-scope.ts';
import { deployment } from './support/deployment.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { provisionExampleRoots } from './support/provision-example-roots.ts';
import { runStatement } from './support/run-statement.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { storeControlNamespace } from './support/store-control-namespace.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';

const opened: PgliteAdapter[] = [];

async function open(): Promise<PgliteAdapter> {
  const adapter = await openClockedPglite();
  opened.push(adapter);
  return adapter;
}

afterEach(async () => {
  for (const adapter of opened.splice(0)) await adapter.close(1000);
});

describe('row-level security of step 0002 on PGlite', () => {
  const insertScoped: readonly (readonly [string, string])[] = [
    ['kw_consumers', `insert into example.kw_consumers values ('c', $1, 1, now())`],
    ['kw_parked', `insert into example.kw_parked values ('c', $1, 'a.b', $1, 1, 3, '{}', now())`],
    [
      'kw_stream_records',
      `insert into example.kw_stream_records values ($1, 's', 'k', 1, now(), '{}')`,
    ],
    ['kw_schedules', `insert into example.kw_schedules values ($1, 'daily', null, now(), now())`],
  ];

  const seen = async (
    adapter: PgliteAdapter,
    scope: StorageScope,
    table: string,
  ): Promise<number> =>
    adapter.unit(
      exampleNamespace,
      scope,
      async (u) => (await runStatement(u, `select 1 from example.${table}`)).rows.length,
    );

  test("a tenant unit sees no other tenant's checkpoint, parked stream, stream record or schedule", async () => {
    const adapter = await open();
    await provisionExampleRoots(adapter);
    for (const [table, sql] of insertScoped) {
      await adapter.unit(exampleNamespace, storageTenant(tenantA), async (u) =>
        runStatement(u, sql, [tenantA]),
      );
      expect(await seen(adapter, storageTenant(tenantA), table)).toBe(1);
      expect(await seen(adapter, storageTenant(tenantB), table)).toBe(0);
      expect(await seen(adapter, backendScope, table)).toBe(0);
      expect(await seen(adapter, namespaceScope, table)).toBe(1);
      await expect(
        adapter.unit(exampleNamespace, storageTenant(tenantB), async (u) =>
          runStatement(u, sql, [tenantA]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  test('consumer leases are reachable from namespace units only', async () => {
    const adapter = await open();
    await provisionExampleRoots(adapter);
    const insert = `insert into example.kw_consumer_leases values ('c', 'owner', now())`;
    await expect(
      adapter.unit(exampleNamespace, storageTenant(tenantA), async (u) => runStatement(u, insert)),
    ).rejects.toMatchObject({ code: '42501' });
    await adapter.unit(exampleNamespace, namespaceScope, async (u) => runStatement(u, insert));
    expect(await seen(adapter, namespaceScope, 'kw_consumer_leases')).toBe(1);
    expect(await seen(adapter, storageTenant(tenantA), 'kw_consumer_leases')).toBe(0);
  });

  const controlInserts: readonly (readonly [string, string])[] = [
    [
      'kw_namespace_identities',
      `insert into kw__control.kw_namespace_identities values ('ns-a', 's', 't', now())`,
    ],
    [
      'kw_scope_marks',
      `insert into kw__control.kw_scope_marks values ('${tenantA}', 'ns-a', 1, '{}', 0, now())`,
    ],
    [
      'kw_leases',
      `insert into kw__control.kw_leases values ('k', null, 'key', 'holder', 1, now())`,
    ],
    [
      'kw_queue_pauses',
      `insert into kw__control.kw_queue_pauses values ('ns-a', 'q', null, '{}', 'r', now())`,
    ],
    [
      'kw_ledger',
      `insert into kw__control.kw_ledger (type, record, recorded_at) values ('t', '{}', now())`,
    ],
    [
      'kw_api_usage',
      `insert into kw__control.kw_api_usage values (current_date, '${deployment}', '${tenantA}', 'v1', 'rest', '', 1)`,
    ],
    [
      'kw_retention_runs',
      `insert into kw__control.kw_retention_runs values ('${deployment}', now(), now(), '${deployment}', null, '{}', '{}', '{}')`,
    ],
  ];

  test('control tables are reachable from deployment units only', async () => {
    const adapter = await open();
    await provisionExampleRoots(adapter);
    for (const [table, insert] of controlInserts) {
      for (const scope of [storageTenant(tenantA), backendScope, namespaceScope]) {
        await expect(
          adapter.unit(storeControlNamespace, scope, async (u) => runStatement(u, insert)),
        ).rejects.toMatchObject({ code: '42501' });
      }
      await adapter.unit(storeControlNamespace, deploymentScope, async (u) =>
        runStatement(u, insert),
      );
      const rows = await adapter.unit(
        storeControlNamespace,
        deploymentScope,
        async (u) => (await runStatement(u, `select 1 from kw__control.${table}`)).rows.length,
      );
      expect(rows).toBe(1);
      const others = await adapter.unit(
        storeControlNamespace,
        namespaceScope,
        async (u) => (await runStatement(u, `select 1 from kw__control.${table}`)).rows.length,
      );
      expect(others).toBe(0);
    }
  });

  test('a queue pause without a namespace covers every namespace and is unique', async () => {
    const adapter = await open();
    await provisionExampleRoots(adapter);
    const pause = `insert into kw__control.kw_queue_pauses values (null, 'q', null, '{}', 'r', now())`;
    await adapter.unit(storeControlNamespace, deploymentScope, async (u) => runStatement(u, pause));
    await expect(
      adapter.unit(storeControlNamespace, deploymentScope, async (u) => runStatement(u, pause)),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  const insertOf = (table: string): string =>
    controlInserts.find(([name]) => name === table)?.[1] ?? '';

  test('the ledger and the retention runs are append only for the application role', async () => {
    const adapter = await open();
    await provisionExampleRoots(adapter);
    for (const table of ['kw_ledger', 'kw_retention_runs']) {
      await adapter.unit(storeControlNamespace, deploymentScope, async (u) =>
        runStatement(u, insertOf(table)),
      );
      for (const sql of [
        `update kw__control.${table} set ${table === 'kw_ledger' ? "type = 'x'" : "rule = '[]'"}`,
        `delete from kw__control.${table}`,
      ]) {
        await expect(
          adapter.unit(storeControlNamespace, deploymentScope, async (u) => runStatement(u, sql)),
        ).rejects.toMatchObject({ code: '42501' });
      }
    }
  });
});
