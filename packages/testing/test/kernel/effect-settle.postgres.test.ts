import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { compareHlc, type DataAdapterFactory } from '@keelwerk/core';
import { afterAll, describe, expect, test, vi } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { startHookEndpoint } from './support/hook-endpoint.ts';
import { bootHooks } from './support/hooks-kit.ts';
import { drainHooks, effectOf, rowsOf } from './support/hooks-reads.ts';

/**
 * Makes units meet: the first caller waits until a second one arrives (or `timeoutMs` passes), and
 * both go on together. `meetings` counts the pairs that met.
 */
function meeting(timeoutMs: number) {
  let waiting: (() => void) | undefined;
  const state = { meetings: 0 };
  return {
    state,
    meet: (): Promise<void> => {
      if (waiting !== undefined) {
        const partner = waiting;
        waiting = undefined;
        state.meetings += 1;
        partner();
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiting = resolve;
        setTimeout(() => {
          if (waiting === resolve) waiting = undefined;
          resolve();
        }, timeoutMs);
      });
    },
  };
}

/**
 * The adapter of `inner` whose units hold every read of an effect row that takes no lock until a
 * second unit has read one too: both units then know the effect as `requested` before either of them
 * writes, which is the interleaving the row lock of `settleEffect` exists for.
 */
function holdingUnlockedEffectReads(
  inner: DataAdapterFactory,
  meet: () => Promise<void>,
): DataAdapterFactory {
  return {
    ...inner,
    create: (placement, env) => {
      const adapter = inner.create(placement, env);
      return {
        ...adapter,
        unit: (namespace, scope, fn, options) => {
          return adapter.unit(
            namespace,
            scope,
            (unit) =>
              fn({
                ...unit,
                rows: {
                  ...unit.rows,
                  // The sealing layer above the adapter reads one row through `find`.
                  find: async (descriptor, query) => {
                    const found = await unit.rows.find(descriptor, query);
                    if (descriptor.ref === 'core.effect' && query.forUpdate !== true) await meet();
                    return found;
                  },
                },
              }),
            options,
          );
        },
      };
    },
  };
}

describe('the settled record of an effect on PostgreSQL (7.9.6)', () => {
  const stops: (() => Promise<void>)[] = [];

  afterAll(async () => {
    await Promise.allSettled(stops.splice(0).map((stop) => stop()));
  });

  test('the settled record links to the requested one: its prevHash is the requested hash and its clock is later', {
    timeout: 120_000,
  }, async () => {
    const endpoint = await startHookEndpoint();
    stops.push(() => endpoint.close());
    const database = await createTestDatabase('effect_settle_chain');
    const booted = await bootHooks({
      adapter: 'memory',
      endpoint: endpoint.url,
      external: { factory: postgresAdapter({ ownerUrl: database.adminUrl }), url: database.appUrl },
    });
    stops.push(() => booted.runtime.stop());
    await booted.client.invoke('hooks.notify', { payload: 'chain' });
    await drainHooks(booted);
    const effect = await effectOf(booted, 'hooks.post');
    expect(effect).toMatchObject({ status: 'succeeded' });
    const events = await booted.raw((unit) =>
      unit.events.readStream({ type: 'core.effect', id: String(effect?.id) }),
    );
    expect(events.map((event) => event.type)).toEqual([
      'core.effect.created',
      'core.effect.changed',
    ]);
    expect(events[0]?.hash).not.toBeNull();
    expect(events[1]?.prevHash).toBe(events[0]?.hash);
    expect(compareHlc(events[1]?.hlc as never, events[0]?.hlc as never)).toBe(1);
  });

  test('two jobs that both read the effect as requested settle it once, and the second finds it settled under the row lock', {
    timeout: 180_000,
  }, async () => {
    // Every request is answered after a pause, so the executors of both jobs overlap.
    const endpoint = await startHookEndpoint(() => 200, 400);
    stops.push(() => endpoint.close());
    const database = await createTestDatabase('effect_settle_race');
    const factory = postgresAdapter({ ownerUrl: database.adminUrl });
    const { meet, state } = meeting(5000);
    const external = { factory: holdingUnlockedEffectReads(factory, meet), url: database.appUrl };
    // P only requests: the effect and its job exist, and no worker takes them yet.
    const p = await bootHooks({
      adapter: 'memory',
      endpoint: endpoint.url,
      external,
      serveOnly: true,
    });
    stops.push(() => p.runtime.stop());
    await p.client.invoke('hooks.notify', { payload: 'twice' });
    const requested = await effectOf(p, 'hooks.post');
    await p.raw((unit) =>
      unit.jobs.enqueue({
        kind: 'effect',
        queue: 'hooks',
        run: { executor: 'hooks.post', effect: String(requested?.id) },
        scope: p.scope,
        principal: { resolver: 'core.module', principalId: 'hooks.system' },
        causation: {},
        build: { id: 'test-build', revision: 1 },
        laneCap: 4,
        createdAt: p.runtime.clock.now(),
        capability: [],
        key: { value: 'duplicate', onConflict: 'keep' },
      }),
    );
    // The two jobs read the effect together at the start of their attempt, and again at the end of it.
    const lines: LoggedLine[] = [];
    const r = await bootHooks({
      adapter: 'memory',
      endpoint: endpoint.url,
      external,
      logger: recordingLogger(lines),
      join: { backendId: p.runtime.backendId, tenants: { acme: p.runtime.tenants.acme.id } },
    });
    stops.push(() => r.runtime.stop());
    await vi.waitFor(
      async () => {
        expect((await effectOf(p, 'hooks.post'))?.status).not.toBe('requested');
      },
      { timeout: 120_000, interval: 500 },
    );
    await drainHooks(r);
    expect(state.meetings).toBeGreaterThanOrEqual(2);
    const effect = await effectOf(p, 'hooks.post');
    const events = await p.raw((unit) =>
      unit.events.readStream({ type: 'core.effect', id: String(effect?.id) }),
    );
    // One record of creation and one of settlement, a linear chain, and one continuation.
    expect(events.map((event) => event.type)).toEqual([
      'core.effect.created',
      'core.effect.changed',
    ]);
    expect(events[1]?.prevHash).toBe(events[0]?.hash);
    expect(compareHlc(events[1]?.hlc as never, events[0]?.hlc as never)).toBe(1);
    const deliveries = await rowsOf(p, 'hooks.delivery');
    expect(deliveries).toHaveLength(1);
    // Created once and settled once: the continuation ran once.
    expect(Number(deliveries[0]?.version)).toBe(2);
    // Without the lock the second settle fails at its append and the end unit has to be saved.
    expect(lines.filter((line) => line.message === 'the end of the attempt failed')).toEqual([]);
  });
});
