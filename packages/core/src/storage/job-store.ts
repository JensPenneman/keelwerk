import type { JobGroup } from '../jobs/job-group.ts';
import type { JobAttempt } from './job-attempt.ts';
import type { JobId } from './job-id.ts';
import type { JobOutcome } from './job-outcome.ts';
import type { ScheduleStore } from './schedule-store.ts';
import type { StoredJob } from './stored-job.ts';
import type { StoredJobSpec } from './stored-job-spec.ts';
import type { WorkClassStats } from './work-class-stats.ts';

/** The job store every adapter provides in its unit (section 14.3.9). */
export interface JobStore {
  /**
   * Creates or re-limits a group row. A namespace-spanning group exists only through this call from a
   * namespace unit, so tenants never wait on each other for it (section 15.1.4); refused elsewhere.
   */
  provisionGroup(group: JobGroup): Promise<void>;
  /** Keys: keep, replace or coalesce a pending job with the same key and lane. */
  enqueue(job: StoredJobSpec): Promise<JobId>;
  /**
   * Cancels the pending jobs of a queue and key. In the timers queue the attempt that is running is
   * cancelled too: a timer never crosses scopes, so its command commits in the unit that completes
   * the job. Its row goes with its lease, so its worker's `complete` answers false and its heartbeat
   * is refused; the unit of the command rolls back, and exactly one of the cancel and that command
   * commits. In every other queue a running job is left to finish and is not counted (its command may commit in
   * another scope's unit, where nothing could take it back). Answers how many it cancelled.
   */
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
  /** One row per schedule and scope: last tick, next tick (S-118). */
  schedules(): ScheduleStore;
}
