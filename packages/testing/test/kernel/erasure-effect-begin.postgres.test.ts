import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { DataAdapterFactory, Unit } from '@keelwerk/core';
import pg from 'pg';
import { afterAll, expect, test, vi } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { bootCourier } from './support/erasure-courier-kit.ts';
import { watching } from './support/watching.ts';

/**
 * The adapter of `inner` whose tenant units park the lease heartbeat of the begin of an attempt: the
 * unit has read the effect and opened its personal members and writes nothing yet.
 */
function parkingBegin(inner: DataAdapterFactory, park: () => Promise<void>): DataAdapterFactory {
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
                      jobs: watching(unit.jobs, {
                        heartbeat: async (...args: Parameters<Unit['jobs']['heartbeat']>) => {
                          await park();
                          return unit.jobs.heartbeat(...args);
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

/**
 * Resolves once a backend waits for a row lock of the effect table that a transaction idle in the
 * database holds (the parked begin): what the visit's read of the effect does behind it.
 */
async function visitWaiting(adminUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await vi.waitFor(
      async () => {
        const { rows } = await client.query(
          `select 1 from pg_stat_activity waiter
            where waiter.wait_event_type = 'Lock' and waiter.datname = current_database()
              and waiter.query ilike '%core__effect%' and waiter.query ilike '%for update%'
              and exists (select 1 from pg_stat_activity holder
                           where holder.pid = any (pg_blocking_pids(waiter.pid))
                             and holder.state = 'idle in transaction')`,
        );
        expect(rows.length).toBeGreaterThan(0);
      },
      { interval: 20 },
    );
  } finally {
    await client.end();
  }
}

const stops: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.allSettled(stops.splice(0).map((stop) => stop()));
});

test('the begin of an attempt and the visit of the erasure cannot interleave: the visit waits for the begin and finds an attempt that started', {
  timeout: 120_000,
}, async () => {
  const database = await createTestDatabase('erasure_effect_begin');
  const gate = {
    armed: false,
    parked: Promise.withResolvers<void>(),
    open: Promise.withResolvers<void>(),
  };
  const park = async (): Promise<void> => {
    if (!gate.armed) return;
    gate.armed = false;
    gate.parked.resolve();
    await gate.open.promise;
  };
  const booted = await bootCourier({
    external: {
      factory: parkingBegin(postgresAdapter({ ownerUrl: database.adminUrl }), park),
      url: database.appUrl,
    },
  });
  stops.push(() => booted.runtime.stop());
  // The subject has a key from an effect that ran; the erasure is recorded and its worker has not
  // run. Then an executor effect is requested.
  await booted.dispatch('first');
  await booted.runtime.drainJobs();
  await booted.ask();
  const id = await booted.dispatch('begin');
  gate.armed = true;
  // The executor ends its attempt only after the erasure's pass, so the visit decides the outcome.
  const passed = Promise.withResolvers<void>();
  booted.attempt.during = () => passed.promise;
  const attempt = booted.runtime.drainJobs();
  try {
    // The begin has read the effect and opened its input; the data key is still there.
    await gate.parked.promise;
    const pass = booted.worker.pass();
    // The visit meets the lock of the begin: only the product's own lock wait lets the begin go on.
    await visitWaiting(database.adminUrl);
    gate.open.resolve();
    await pass;
    passed.resolve();
    await attempt;
  } finally {
    gate.open.resolve();
    passed.resolve();
  }
  await booted.runtime.drainJobs();

  // The begin committed its start first, so the visit found an attempt that started, not one that did not.
  expect(await booted.effectRow(id)).toMatchObject({
    status: 'abandoned',
    error: { code: 'core.effect_outcome_unknown' },
  });
  expect((await booted.attemptRecords(id)).at(-1)?.endedAt).toBeDefined();
});
