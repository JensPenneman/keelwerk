import type { JobAttempt } from './job-attempt.ts';
import type { JobId } from './job-id.ts';
import type { JobOutcome } from './job-outcome.ts';
import type { StoredJob } from './stored-job.ts';
import type { StoredJobSpec } from './stored-job-spec.ts';
import type { WorkClassStats } from './work-class-stats.ts';

/**
 * The job store every adapter provides in its unit (section 14.3.9). `schedules()` arrives in M2
 * with the schedule store (S-03).
 */
export interface JobStore {
  /** Keys: keep, replace or coalesce a pending job with the same key and lane. */
  enqueue(job: StoredJobSpec): Promise<JobId>;
  cancel(queue: string, key: string): Promise<number>;
  /** Moves due `scheduled` jobs (timers, retries, delayed sends) to `available` and counts them on their lanes. */
  promote(queue: string, limit: number): Promise<number>;
  /**
   * The fair take of section 9.5.3 over the lanes of the worker's capability sets: lane caps, keys,
   * FIFO order per key and group limits; reclaims expired leases first; only jobs enqueued at or
   * below `maxRevision`, the worker's build revision (section 19.2). `lanes` defaults to `limit`;
   * `skippedLanes` counts lanes locked by other takers, not "no work".
   */
  take(
    queue: string,
    worker: string,
    request: {
      readonly limit: number;
      readonly lanes?: number;
      readonly capabilitySets: readonly string[];
      readonly maxRevision: number;
      readonly leaseMs: number;
    },
  ): Promise<{ readonly jobs: readonly StoredJob[]; readonly skippedLanes: number }>;
  /** Conditional on (worker, attempt); returns the attempts whose lease still holds. */
  heartbeat(
    attempts: readonly JobAttempt[],
    worker: string,
    leaseMs: number,
  ): Promise<readonly JobAttempt[]>;
  /** Conditional on (worker, attempt): succeeded (history written), retry at a time, or dead letter; false when the lease was lost. */
  complete(attempt: JobAttempt, worker: string, outcome: JobOutcome): Promise<boolean>;
  /** Per queue and capability set, from the lane tables (section 21.4). */
  stats(queue?: string): Promise<readonly WorkClassStats[]>;
}
