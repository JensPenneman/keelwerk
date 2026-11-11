import type { Clock, LiveTimers } from '@keelwerk/core';

/** The live timers of a test: waits that fire when the test says so. */
export interface PinnedLiveTimers extends LiveTimers {
  /** Resolves every wait whose instant the clock has reached, yields once to the event loop, and answers how many it resolved. */
  fire(): Promise<number>;
  /** How many waits are neither resolved nor aborted. */
  pending(): number;
}

/**
 * Live timers that never run on their own: a wait resolves in `fire()` once the test's clock has
 * reached its instant, and with `false` when its signal aborts. A test moves the clock, calls `fire()`
 * and reads what happened, with no real time and no fake timers.
 */
export function pinnedLiveTimers(clock: Clock): PinnedLiveTimers {
  const waits = new Set<{
    readonly at: Temporal.Instant;
    readonly resolve: (reached: boolean) => void;
  }>();
  return {
    sleepUntil: (at, signal) =>
      new Promise<boolean>((resolve) => {
        if (signal.aborted) {
          resolve(false);
          return;
        }
        const wait = {
          at,
          resolve: (reached: boolean) => {
            waits.delete(wait);
            signal.removeEventListener('abort', onAbort);
            resolve(reached);
          },
        };
        const onAbort = (): void => wait.resolve(false);
        signal.addEventListener('abort', onAbort, { once: true });
        waits.add(wait);
      }),
    fire: async () => {
      const now = clock.now();
      const due = [...waits].filter((wait) => Temporal.Instant.compare(now, wait.at) >= 0);
      for (const wait of due) wait.resolve(true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      return due.length;
    },
    pending: () => waits.size,
  };
}
