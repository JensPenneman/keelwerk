import type { Clock } from '@keelwerk/core';
import { pinnedLiveTimers } from '@keelwerk/testing';

/** A clock and pinned timers that move together, with the instant they started at. */
export function pinnedTime(): {
  start: Temporal.Instant;
  clock: Clock;
  move(ms: number): Promise<void>;
  /** Moves the clock without firing a wait: the instant a timer that is late would still miss. */
  jump(ms: number): void;
  timers: ReturnType<typeof pinnedLiveTimers>;
} {
  const start = Temporal.Instant.from('2026-11-19T10:00:00Z');
  let now = start;
  const clock: Clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  return {
    start,
    clock,
    timers,
    jump: (ms) => {
      now = now.add({ milliseconds: ms });
    },
    // Twice per step, as a wait registered by a firing wait is due in the same instant.
    move: async (ms) => {
      now = now.add({ milliseconds: ms });
      await timers.fire();
      await timers.fire();
    },
  };
}
