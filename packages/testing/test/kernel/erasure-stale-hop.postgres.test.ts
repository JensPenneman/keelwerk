import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { DataAdapterFactory, Scope, Unit } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import pg from 'pg';
import { afterAll, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { chainApp } from './support/erasure-chain-app.ts';
import { watching } from './support/watching.ts';

/** The adapter of `inner` whose tenant units park the unit that updates an item row, right after the update (the row stays locked). */
function parkingUpdate(inner: DataAdapterFactory, park: () => Promise<void>): DataAdapterFactory {
  return {
    ...inner,
    create: (placement, env) => {
      const adapter = inner.create(placement, env);
      return {
        ...adapter,
        unit: (namespace, scope, fn, options) =>
          adapter.unit(
            namespace,
            scope,
            (unit) =>
              scope.level !== 'tenant'
                ? fn(unit)
                : fn(
                    watching(unit, {
                      rows: watching(unit.rows, {
                        update: async (...args: Parameters<Unit['rows']['update']>) => {
                          await unit.rows.update(...args);
                          if (args[0].ref === 'chain.item2') await park();
                        },
                      }),
                    }),
                  ),
            options,
          ),
      };
    },
  };
}

const stops: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.allSettled(stops.splice(0).map((stop) => stop()));
});

test('an item moved to a living subject while the erasure reads it, whose holder went to the erased subject meanwhile, is left alone with its key', {
  timeout: 120_000,
}, async () => {
  const database = await createTestDatabase('erasure_stale_hop');
  const worker = erasure({ pollMs: 3_600_000 });
  const gate = {
    armed: false,
    parked: Promise.withResolvers<void>(),
    open: Promise.withResolvers<void>(),
  };
  const runtime = await startTestRuntime(chainApp, {
    external: {
      factory: parkingUpdate(postgresAdapter({ ownerUrl: database.adminUrl }), async () => {
        if (!gate.armed) return;
        gate.armed = false;
        gate.parked.resolve();
        await gate.open.promise;
      }),
      url: database.appUrl,
    },
    operators: true,
    workers: true,
    tenants: ['acme'],
    eventWorkers: [worker],
  });
  stops.push(() => runtime.stop());
  const scope: Scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const itemRow = (id: string) =>
    runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
      const descriptor = runtime.app.registry.entities.get('chain.item2')?.descriptor;
      if (descriptor === undefined) throw new Error('no item entity');
      return (
        await unit.rows.find(descriptor, { includeArchived: true, includeErased: true })
      ).rows.find((row) => row.id === id);
    });
  const make = async (kind: string, link: string, secret?: string) =>
    String(
      (
        (await operator.invoke('chain.make', {
          kind,
          link,
          ...(secret === undefined ? {} : { secret }),
        } as never)) as { id: string }
      ).id,
    );
  const [ada, bea, carl] = [
    await make('member', 'ada@example.test'),
    await make('member', 'bea@example.test'),
    await make('member', 'carl@example.test'),
  ];
  const [h1, h2] = [await make('holder2', carl), await make('holder2', bea)];
  const item = await make('item2', h1, 'item secret');
  const key =
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
      JSON.stringify((await itemRow(item))?.secret),
    )?.[1] ?? '';

  // The move to bea's holder is open, holding the item's lock; the old holder is handed to ada meanwhile.
  gate.armed = true;
  const moving = operator.attempt('chain.change', { kind: 'item2', id: item, link: h2 } as never);
  await Promise.race([gate.parked.promise, moving]);
  expect(gate.armed).toBe(false);
  expect(
    await operator.attempt('chain.change', { kind: 'holder2', id: h1, link: ada } as never),
  ).toMatchObject({ ok: true });

  // What the database sees: the erasure's unit waits for the item's lock; only then the move commits.
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  let waited = false;
  let polling = true;
  const watcher = (async () => {
    while (polling) {
      const { rows } = await admin.query(
        `select 1 from pg_stat_activity waiter
          where waiter.wait_event_type = 'Lock' and waiter.datname = current_database()
            and exists (select 1 from pg_stat_activity holder
                         where holder.pid = any (pg_blocking_pids(waiter.pid))
                           and holder.state = 'idle in transaction')`,
      );
      if (rows.length > 0) {
        waited = true;
        gate.open.resolve();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  })();

  await operator.invoke(
    'core.eraseSubject',
    { subjectId: ada as never, reason: 'subjectRequest' } as never,
    { prefer: 'async' },
  );
  await runtime.drainJobs();
  await worker.pass();
  await runtime.drainJobs();
  polling = false;
  gate.open.resolve();
  const moved = await moving;
  await watcher;
  await admin.end();

  expect(waited).toBe(true);
  expect(moved).toMatchObject({ ok: true });
  expect(await itemRow(item)).toMatchObject({ holderId: h2 });
  expect(
    await runtime.adapter.unit(runtime.namespace, scope, (unit) => unit.keys.liveValueKeys([key])),
  ).toEqual([key]);
});
