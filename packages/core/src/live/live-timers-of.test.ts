import { afterEach, describe, expect, test } from 'vitest';
import { liveTimersOf } from './live-timers-of.ts';

const start = Temporal.Instant.from('2026-11-11T12:00:00Z');

/** A clock the test moves (it follows real time only where the test says so). */
function movingClock() {
  let at = start;
  return { clock: { now: () => at }, set: (instant: Temporal.Instant) => (at = instant) };
}

const aborts: AbortController[] = [];
afterEach(() => {
  for (const abort of aborts.splice(0)) abort.abort();
});

function signal(): AbortController {
  const abort = new AbortController();
  aborts.push(abort);
  return abort;
}

describe('liveTimersOf', () => {
  test('resolves true once the clock has reached the instant, never early', async () => {
    const moving = movingClock();
    const timers = liveTimersOf(moving.clock);
    let reached = false;
    const slept = timers
      .sleepUntil(start.add({ milliseconds: 40 }), signal().signal)
      .then((value) => {
        reached = value;
        return value;
      });
    // The real timer fires after 40 ms, but the clock has not moved: the wait goes on.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(reached).toBe(false);
    moving.set(start.add({ milliseconds: 39 }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reached).toBe(false);
    moving.set(start.add({ milliseconds: 40 }));
    expect(await slept).toBe(true);
  });

  test('an instant that has passed resolves true at once', async () => {
    const moving = movingClock();
    expect(await liveTimersOf(moving.clock).sleepUntil(start, signal().signal)).toBe(true);
  });

  test('false when the signal aborts, also when it is aborted already', async () => {
    const timers = liveTimersOf(movingClock().clock);
    const abort = signal();
    const slept = timers.sleepUntil(start.add({ hours: 1 }), abort.signal);
    abort.abort();
    expect(await slept).toBe(false);
    expect(await timers.sleepUntil(start.add({ hours: 1 }), abort.signal)).toBe(false);
  });

  test('reaching the instant removes the abort listener, so a long-lived signal collects none', async () => {
    const moving = movingClock();
    const timers = liveTimersOf(moving.clock);
    const abort = signal();
    const removed: string[] = [];
    const original = abort.signal.removeEventListener.bind(abort.signal);
    abort.signal.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      return (original as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof abort.signal.removeEventListener;
    expect(await timers.sleepUntil(start, abort.signal)).toBe(true);
    expect(removed).toContain('abort');
  });
});
