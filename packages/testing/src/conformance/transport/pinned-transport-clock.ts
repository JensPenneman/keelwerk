import type { Clock } from '@keelwerk/core';
import { type PinnedLiveTimers, pinnedLiveTimers } from '../../harness/pinned-live-timers.ts';

/** A clock that only the test moves, the live timers waiting on it, and the one call that moves it. */
export interface PinnedTransportClock {
  readonly clock: Clock;
  readonly timers: PinnedLiveTimers;
  /** Moves the clock `ms` forward and fires what is due, twice: a wait that the first firing set is due too. */
  advance(ms: number): Promise<void>;
}

/** A pinned clock and timers for `startTransportRuntime`, and the `advance` a target hands to the cases that need time to pass. */
export function pinnedTransportClock(start: Temporal.Instant): PinnedTransportClock {
  let now = start;
  const clock: Clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  return {
    clock,
    timers,
    advance: async (ms) => {
      now = now.add({ milliseconds: ms });
      await timers.fire();
      await timers.fire();
    },
  };
}
