// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework table
import { afterEach, expect, test } from 'vitest';
import type { PgliteAdapter } from '../src/pglite/index.ts';
import { exampleNamespace } from './support/example-namespace.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { openClockedPglite } from './support/open-clocked-pglite.ts';
import { provisionExampleRoots } from './support/provision-example-roots.ts';
import { runStatement } from './support/run-statement.ts';
import { storageTenant } from './support/storage-tenant.ts';
import { tenantA } from './support/tenant-a.ts';

const opened: PgliteAdapter[] = [];

afterEach(async () => {
  for (const adapter of opened.splice(0)) await adapter.close(1000);
});

test('the stored kw_schedules row', { timeout: 30_000 }, async () => {
  const adapter = await openClockedPglite();
  opened.push(adapter);
  await provisionExampleRoots(adapter);
  const first = Temporal.Instant.from('2026-11-10T12:05:00Z');
  const second = Temporal.Instant.from('2026-11-10T12:10:00.123456Z');
  await adapter.unit(exampleNamespace, storageTenant(tenantA), async (unit) => {
    await unit.jobs.schedules().upsert('ticker.everyTenant', first);
  });
  const stored = async () =>
    adapter.unit(
      exampleNamespace,
      namespaceScope,
      async (unit) =>
        (
          await runStatement(
            unit,
            `select scope_id::text as scope_id, schedule_id, last_tick::text as last_tick, next_tick::text as next_tick, updated_at::text as updated_at from example.kw_schedules`,
          )
        ).rows,
    );
  expect(await stored()).toEqual([
    {
      scope_id: tenantA,
      schedule_id: 'ticker.everyTenant',
      last_tick: null,
      next_tick: '2026-11-10 12:05:00+00',
      updated_at: '2026-11-10 12:00:00+00',
    },
  ]);
  const claimed = await adapter.unit(exampleNamespace, namespaceScope, async (unit) =>
    unit.jobs.schedules().claimTick('ticker.everyTenant', tenantA, first, second),
  );
  expect(claimed).toBe(true);
  expect(await stored()).toEqual([
    {
      scope_id: tenantA,
      schedule_id: 'ticker.everyTenant',
      last_tick: '2026-11-10 12:05:00+00',
      next_tick: '2026-11-10 12:10:00.123+00',
      updated_at: '2026-11-10 12:00:00+00',
    },
  ]);
});
