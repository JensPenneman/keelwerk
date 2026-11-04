import type { Clock } from '@keelwerk/core';

/** The system clock plus an offset the test moves forward instead of waiting. */
export interface OffsetClock extends Clock {
  advance(milliseconds: number): void;
}

export function offsetClock(): OffsetClock {
  let offset = 0;
  return {
    now: () => Temporal.Now.instant().add({ milliseconds: offset }),
    advance: (milliseconds) => {
      offset += milliseconds;
    },
  };
}
