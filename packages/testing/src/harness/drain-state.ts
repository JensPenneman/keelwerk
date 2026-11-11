import type { WorkersProbe } from '@keelwerk/core';

/** What one test runtime remembers of its workers: their probe once the runtime hands it over, and the attempts counted so far. */
export interface DrainState {
  probe: WorkersProbe | undefined;
  /** What the probe had settled when it was last drained, so a drain counts the attempts that ran on their own wake-ups too. */
  counted: number;
}
