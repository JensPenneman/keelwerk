import { describe, expect, test } from 'vitest';
import type { ConcurrencyLeases } from '../quotas/concurrency-leases.ts';
import { keepLeases } from './keep-leases.ts';
import type { RuntimeServiceContext } from './runtime-service-context.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

/** Timers that wait for `tick()`, and a counter that records its passes. */
function setup(options: { readonly failFirst?: boolean; readonly noLeases?: boolean } = {}) {
  let ms = Date.parse('2026-11-23T10:00:00Z');
  const clock = { now: () => Temporal.Instant.fromEpochMilliseconds(ms) };
  const waiting: { readonly at: Temporal.Instant; readonly wake: (value: boolean) => void }[] = [];
  const timers = {
    sleepUntil: (at: Temporal.Instant, signal: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        if (signal.aborted) {
          resolve(false);
          return;
        }
        waiting.push({ at, wake: resolve });
        signal.addEventListener('abort', () => resolve(false), { once: true });
      }),
  };
  const passes: number[] = [];
  const warnings: Record<string, unknown>[] = [];
  const leases: ConcurrencyLeases = {
    take: async () => () => undefined,
    pass: async () => {
      passes.push(ms);
      if (options.failFirst === true && passes.length === 1) {
        throw Object.assign(new Error('away'), { code: 'core.unavailable' });
      }
    },
  };
  const service = keepLeases({
    options: { timers },
    clock,
    ...(options.noLeases === true ? {} : { leases }),
  } as unknown as StartPhaseInput);
  const context = {
    signal: new AbortController().signal,
    log: { warn: (_message: string, fields: Record<string, unknown>) => warnings.push(fields) },
  } as unknown as RuntimeServiceContext;
  return {
    service,
    context,
    passes,
    warnings,
    waits: () => waiting.map((wait) => wait.at.epochMilliseconds - ms),
    /** Moves the clock to the wait's instant and wakes it, then lets the pass run. */
    tick: async () => {
      const wait = waiting.shift();
      if (wait === undefined) throw new Error('no wait is pending');
      ms = wait.at.epochMilliseconds;
      wait.wake(true);
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    },
  };
}

describe('the core.leases service', () => {
  test('runs the pass of the counter every ten seconds of the clock, in the roles serve and work', async () => {
    const kit = setup();
    expect(kit.service.id).toBe('core.leases');
    expect(kit.service.roles).toEqual(['serve', 'work']);
    await kit.service.start(kit.context);
    expect(kit.waits()).toEqual([10_000]);
    await kit.tick();
    await kit.tick();
    expect(kit.passes).toEqual([
      Date.parse('2026-11-23T10:00:10Z'),
      Date.parse('2026-11-23T10:00:20Z'),
    ]);
    await kit.service.stop(Temporal.Now.instant());
  });

  test('logs a failed pass at warn with its code and goes on', async () => {
    const kit = setup({ failFirst: true });
    await kit.service.start(kit.context);
    await kit.tick();
    expect(kit.warnings).toEqual([{ code: 'core.unavailable' }]);
    await kit.tick();
    expect(kit.passes).toHaveLength(2);
    await kit.service.stop(Temporal.Now.instant());
  });

  test('stop ends the loop, so no pass follows', async () => {
    const kit = setup();
    await kit.service.start(kit.context);
    await kit.service.stop(Temporal.Now.instant());
    expect(kit.waits()).toEqual([10_000]);
    expect(kit.passes).toEqual([]);
  });

  test('a start without slots waits for nothing', async () => {
    const kit = setup({ noLeases: true });
    await kit.service.start(kit.context);
    expect(kit.waits()).toEqual([]);
    await kit.service.stop(Temporal.Now.instant());
  });
});
