import { describe, expect, test } from 'vitest';
import type { LiveTimers } from '../live/live-timers.ts';
import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import type { StartPhaseInput } from '../runtime/start-phase-input.ts';
import { flushUsage } from './flush-usage.ts';

/** A clock and timers that move only when the case says so. */
function world() {
  let current = Temporal.Instant.from('2026-11-12T10:00:00Z');
  const waiting: { at: Temporal.Instant; signal: AbortSignal; resolve: (ok: boolean) => void }[] =
    [];
  const timers: LiveTimers = {
    sleepUntil: (at, signal) =>
      new Promise<boolean>((resolve) => {
        const entry = { at, signal, resolve };
        waiting.push(entry);
        signal.addEventListener('abort', () => resolve(false), { once: true });
      }),
  };
  return {
    clock: { now: () => current },
    timers,
    advance(seconds: number) {
      current = current.add({ seconds });
      for (const entry of waiting.splice(0)) {
        if (Temporal.Instant.compare(current, entry.at) >= 0) entry.resolve(true);
        else waiting.push(entry);
      }
    },
  };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function setup(failures = 0) {
  const w = world();
  const flushed: number[] = [];
  const warnings: unknown[] = [];
  let left = failures;
  const context = {
    control: {
      apiUsage: {
        flush: async () => {
          if (left > 0) {
            left -= 1;
            throw Object.assign(new Error('down'), { code: 'core.unavailable' });
          }
          flushed.push(flushed.length + 1);
          return 1;
        },
      },
    },
    log: { warn: (_message: string, fields: unknown) => warnings.push(fields) },
    signal: new AbortController().signal,
  } as unknown as RuntimeServiceContext;
  const input = {
    clock: w.clock,
    options: { timers: w.timers },
  } as unknown as StartPhaseInput;
  return { w, flushed, warnings, context, service: flushUsage(input) };
}

describe('flushUsage (section 18.5)', () => {
  test('flushes once per minute of the runtime clock and not before', async () => {
    const { w, flushed, context, service } = setup();
    await service.start(context);
    w.advance(59);
    await settle();
    expect(flushed).toHaveLength(0);
    w.advance(1);
    await settle();
    expect(flushed).toHaveLength(1);
    w.advance(30);
    await settle();
    expect(flushed).toHaveLength(1);
    w.advance(30);
    await settle();
    expect(flushed).toHaveLength(2);
    await service.stop(Temporal.Now.instant().add({ seconds: 1 }));
  });

  test('a failed flush keeps its counts for the next one and is logged with its code', async () => {
    const { w, flushed, warnings, context, service } = setup(1);
    await service.start(context);
    w.advance(60);
    await settle();
    expect(flushed).toHaveLength(0);
    expect(warnings).toEqual([{ code: 'core.unavailable' }]);
    w.advance(60);
    await settle();
    expect(flushed).toHaveLength(1);
    await service.stop(Temporal.Now.instant().add({ seconds: 1 }));
  });

  test('stop flushes what is left', async () => {
    const { flushed, context, service } = setup();
    await service.start(context);
    await service.stop(Temporal.Now.instant().add({ seconds: 1 }));
    expect(flushed).toHaveLength(1);
  });
});
