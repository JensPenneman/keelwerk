import type { Clock } from '@keelwerk/core';
import { drainJobs } from './drain-jobs.ts';
import type { DrainState } from './drain-state.ts';

/**
 * Pins the runtime clock at `at` (RangeError when that is earlier than the clock reads now), then
 * drains the jobs when workers run and answers the attempts they settled, else answers 0.
 */
export async function advanceTo(
  target: {
    readonly clock: Clock;
    pin(at: Temporal.Instant): void;
    readonly workers: DrainState;
  },
  at: Temporal.Instant,
): Promise<number> {
  if (Temporal.Instant.compare(at, target.clock.now()) < 0) {
    throw new RangeError(`The clock reads ${target.clock.now()}, which is later than ${at}.`);
  }
  target.pin(at);
  return target.workers.probe === undefined ? 0 : drainJobs(target.workers);
}
