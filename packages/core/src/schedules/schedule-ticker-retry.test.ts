import { expect, onTestFinished, test, vi } from 'vitest';
import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import { createScheduleTicker } from './schedule-ticker.ts';

const passes = vi.hoisted(() => ({ count: 0, outcome: 'fail' as 'fail' | 'ok' }));
vi.mock('../worker/framework-ready.ts', () => ({ frameworkReady: async () => true }));
vi.mock('./run-schedule-pass.ts', () => ({
  runSchedulePass: async () => {
    passes.count += 1;
    if (passes.outcome === 'fail') throw new Error('the database is away');
  },
}));

const start = Temporal.Instant.from('2026-01-01T00:00:00Z');

/** The context of a ticker over one namespace with schedules, on a clock the test moves. */
function contextAt(clock: { now(): Temporal.Instant }, queue: object = {}): RuntimeServiceContext {
  const never = () => undefined;
  const source = {
    namespace: { id: 'ns-app', appId: 'app' },
    registry: { schedules: new Map([['m.every', {}]]) },
  };
  return {
    clock,
    signal: new AbortController().signal,
    log: { info: never, warn: never, error: never, debug: never, child: () => never },
    namespaces: [source],
    control: { namespace: { id: 'ns-control' } },
    apps: new Map([['app', {}]]),
    queue,
  } as unknown as RuntimeServiceContext;
}

test('a namespace whose pass keeps failing is passed again after the pauses of the policy, and a pass that succeeds starts them again', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  passes.count = 0;
  passes.outcome = 'fail';
  let now = start;
  const context = contextAt({ now: () => now });
  const ticker = createScheduleTicker({ passEveryMs: 100 }, () => 0.5);
  await ticker.start(context);
  onTestFinished(async () => {
    await ticker.stop(Temporal.Now.instant());
  });
  /** The clock moves to `milliseconds` after the start; the timer fires once. */
  const timerAt = async (milliseconds: number): Promise<number> => {
    now = start.add({ milliseconds });
    await vi.advanceTimersByTimeAsync(100);
    return passes.count;
  };
  await vi.advanceTimersByTimeAsync(0);
  // The first pass at the start failed: the pause is a second.
  expect(passes.count).toBe(1);
  expect(await timerAt(999)).toBe(1);
  expect(await timerAt(1000)).toBe(2);
  // The second failure in a row: two seconds.
  expect(await timerAt(2999)).toBe(2);
  // The pass that comes then succeeds: nothing holds the next timer back.
  passes.outcome = 'ok';
  expect(await timerAt(3000)).toBe(3);
  // A failure after a success is the first again: a pause of a second, not of four.
  passes.outcome = 'fail';
  expect(await timerAt(3001)).toBe(4);
  expect(await timerAt(4000)).toBe(4);
  expect(await timerAt(4001)).toBe(5);
});

test('a pass that an explicit trigger ran successfully lifts the pause the timer keeps', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  passes.count = 0;
  passes.outcome = 'fail';
  let now = start;
  let attended: (() => Promise<void>) | undefined;
  const queue = {
    sourceOf: () => undefined,
    probe: {},
    attend: (run: () => Promise<void>) => {
      attended = run;
    },
  };
  const ticker = createScheduleTicker({ passEveryMs: 100 }, () => 0.5);
  await ticker.start(contextAt({ now: () => now }, queue));
  onTestFinished(async () => {
    await ticker.stop(Temporal.Now.instant());
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(passes.count).toBe(1);
  // The pause lasts until 1000 ms; the probe's run at 500 ms succeeds, and the timer at 600 ms is
  // free.
  passes.outcome = 'ok';
  now = start.add({ milliseconds: 500 });
  await attended?.();
  expect(passes.count).toBe(2);
  now = start.add({ milliseconds: 600 });
  await vi.advanceTimersByTimeAsync(100);
  expect(passes.count).toBe(3);
});
