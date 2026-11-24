import { describe, expect, test } from 'vitest';
import type { ConcurrencyLeases } from '../quotas/concurrency-leases.ts';
import { keepLeases } from './keep-leases.ts';
import type { RuntimeServiceContext } from './runtime-service-context.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

/**
 * Timers that answer the first `answers` waits at once, at their instant (the clock moves there),
 * and then answer `false` at once, as a stopped service does; with `parks` the next wait stays
 * pending until its signal aborts. `parked` settles when that wait has begun, so the loop's verdict
 * is read after a signal and no turn of the event loop is counted.
 */
function setup(
  options: {
    readonly answers?: number;
    readonly failFirst?: boolean;
    readonly noLeases?: boolean;
    readonly parks?: boolean;
  } = {},
) {
  let ms = Date.parse('2026-11-23T10:00:00Z');
  const clock = { now: () => Temporal.Instant.fromEpochMilliseconds(ms) };
  const waits: number[] = [];
  const signals: AbortSignal[] = [];
  let answered = 0;
  let park!: () => void;
  const parked = new Promise<void>((resolve) => {
    park = resolve;
  });
  const timers = {
    sleepUntil: async (at: Temporal.Instant, signal: AbortSignal) => {
      waits.push(at.epochMilliseconds - ms);
      signals.push(signal);
      if (answered < (options.answers ?? 0)) {
        answered += 1;
        ms = at.epochMilliseconds;
        return true;
      }
      if (options.parks !== true) return false;
      park();
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return false;
    },
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
      // A pass takes five seconds of the clock.
      ms += 5_000;
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
  return { service, context, passes, warnings, waits, signals, parked };
}

const start = Date.parse('2026-11-23T10:00:00Z');

describe('the core.leases service', () => {
  test('runs the pass of the counter every ten seconds of the clock after the last pass has ended, in the roles serve and work', async () => {
    const kit = setup({ answers: 2 });
    expect(kit.service.id).toBe('core.leases');
    expect(kit.service.roles).toEqual(['serve', 'work']);
    await kit.service.start(kit.context);
    await kit.service.stop(Temporal.Now.instant());
    expect(kit.passes).toEqual([start + 10_000, start + 25_000]);
    // The first wait is ten seconds from the start, the second ten from the end of the first pass, the third the same.
    expect(kit.waits).toEqual([10_000, 10_000, 10_000]);
  });

  test('logs a failed pass at warn with its code and goes on', async () => {
    const kit = setup({ answers: 2, failFirst: true });
    await kit.service.start(kit.context);
    await kit.service.stop(Temporal.Now.instant());
    expect(kit.warnings).toEqual([{ code: 'core.unavailable' }]);
    expect(kit.passes).toHaveLength(2);
  });

  test('stop aborts the wait of the loop, so no pass follows', async () => {
    const kit = setup({ parks: true });
    await kit.service.start(kit.context);
    await kit.parked;
    // The call itself aborts the wait, before the loop is awaited.
    const stopping = kit.service.stop(Temporal.Now.instant());
    expect(kit.signals.at(-1)?.aborted).toBe(true);
    await stopping;
    expect(kit.signals.every((signal) => signal.aborted)).toBe(true);
    expect(kit.waits).toEqual([10_000]);
    expect(kit.passes).toEqual([]);
  });

  test('a start without slots waits for nothing', async () => {
    const kit = setup({ noLeases: true });
    await kit.service.start(kit.context);
    await kit.service.stop(Temporal.Now.instant());
    expect(kit.waits).toEqual([]);
  });
});
