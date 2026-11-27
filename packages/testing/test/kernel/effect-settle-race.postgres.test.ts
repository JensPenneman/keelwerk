import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { DataAdapterFactory } from '@keelwerk/core';
import { afterAll, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { bootCourier } from './support/erasure-courier-kit.ts';
import { watching } from './support/watching.ts';

/**
 * The adapter of `inner` whose tenant units hold the first two reads of an effect row that take no
 * lock until both have happened: both units then know the effect as `requested` before either
 * settles it, which is the interleaving the row lock inside the settle exists for.
 */
function holdingUnlockedEffectReads(inner: DataAdapterFactory, state: { met: boolean }) {
  const waiting: (() => void)[] = [];
  const meet = (): Promise<void> => {
    if (state.met) return Promise.resolve();
    if (waiting.length > 0) {
      state.met = true;
      for (const release of waiting.splice(0)) release();
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  };
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
                        find: async (...args: Parameters<typeof unit.rows.find>) => {
                          const found = await unit.rows.find(...args);
                          const [descriptor, query] = args;
                          if (descriptor.ref === 'core.effect' && query.forUpdate !== true) {
                            await meet();
                          }
                          return found;
                        },
                      }),
                    }),
                  ),
            options,
          ),
      };
    },
  } satisfies DataAdapterFactory;
}

const stops: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.allSettled(stops.splice(0).map((stop) => stop()));
});

test('the settle of a performer and the deadline job that both read the effect as requested settle it once, and the loser writes nothing', {
  timeout: 120_000,
}, async () => {
  const database = await createTestDatabase('effect_settle_deadline');
  const state = { met: false };
  const booted = await bootCourier({
    external: {
      factory: holdingUnlockedEffectReads(postgresAdapter({ ownerUrl: database.adminUrl }), state),
      url: database.appUrl,
    },
  });
  stops.push(() => booted.runtime.stop());
  const now = booted.runtime.clock.now();
  const { id } = await booted.send({ deadline: now.add({ hours: 1 }) });
  state.met = false;

  // The deadline job and the performer's report each read the effect as requested before either settles it.
  const [, answer] = await Promise.all([
    booted.runtime.advanceTo(now.add({ hours: 2 })),
    booted.call('courier.report', { effectId: id, seal: 'late seal' }),
  ]);
  await booted.runtime.drainJobs();

  expect(state.met).toBe(true);
  const events = await booted.runtime.adapter.unit(booted.runtime.namespace, booted.scope, (unit) =>
    unit.events.readStream({ type: 'core.effect', id }),
  );
  expect(events.map((event) => event.type)).toEqual(['core.effect.created', 'core.effect.changed']);
  expect(events[1]?.prevHash).toBe(events[0]?.hash);
  // One settle, one continuation, and the loser met the settled row: a conflict for the performer, nothing for the job.
  expect(await booted.rows('courier.logbook')).toHaveLength(1);
  const settled = await booted.effectRow(id);
  expect(answer.ok ? 'settled' : answer.error.kind).toBe(
    settled.status === 'succeeded' ? 'settled' : 'conflict',
  );
});
