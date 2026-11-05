import type { Clock } from '@keelwerk/core';

/** A clock the test moves by hand. */
export interface TestClock extends Clock {
  advance(milliseconds: number): void;
  /** Moves the clock to `instant`, sub-millisecond readings included. */
  set(instant: Temporal.Instant): void;
}

export function testClock(start: Temporal.Instant): TestClock {
  let current = start;
  return {
    now: () => current,
    advance: (milliseconds) => {
      current = current.add({ milliseconds });
    },
    set: (instant) => {
      current = instant;
    },
  };
}
