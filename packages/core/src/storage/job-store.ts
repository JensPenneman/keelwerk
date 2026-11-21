import type { JobGroup } from '../jobs/job-group.ts';
import type { JobAttempt } from './job-attempt.ts';
import type { JobId } from './job-id.ts';
import type { JobOutcome } from './job-outcome.ts';
import type { PurgeBatch } from './purge-batch.ts';
import type { PurgedJob } from './purged-job.ts';
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
  /**
   * Keys: keep, replace or coalesce a pending job with the same key and lane. Under a FIFO key
   * (`ordering: 'fifo-per-key'`) the appended job is `waiting` behind the key's head. An adapter
   * must serialise the append with every unit that ends the head (a completion, a reclaim, a purge,
   * a replace, a cancel by key): the append sees the head as it is after such a unit committed, or that unit releases
   * the appended job after the append's commit; a take that cannot get the serialisation without waiting
   * leaves the head it would end to a later take. A job appended under a key is never left `waiting`
   * without a head.
   */
  enqueue(job: StoredJobSpec): Promise<JobId>;
  /**
   * Cancels the pending jobs of a queue and key. In the timers and hooks queues the attempt that is
   * running is cancelled too: such a job never crosses scopes, so its command commits in the unit
   * that completes the job. Its row goes with its lease, so its worker's `complete` answers false and its heartbeat
   * is refused; the unit of the command rolls back, and exactly one of the cancel and that command
   * commits. In every other queue a running job is left to finish and is not counted (its command may commit in
   * another scope's unit, where nothing could take it back). Under a FIFO key the cancel serialises with
   * an append under the key: an append that committed before the cancel is cancelled with the key's
   * other jobs; an append that comes after it waits behind a running head the cancel left, or, with
   * none left, is available. Answers how many it cancelled.
   */
  cancel(queue: string, key: string): Promise<number>;
  /**
   * Moves due `scheduled` jobs (timers, retries, delayed sends) to `available` and counts them on their
   * lanes. A store may count them only when its unit commits, so that a take of the same unit does not
   * see them; the bundled stores count them at once. A store that waits for no lock may leave the due
   * jobs of a lane whose counter row another unit holds `scheduled`; the take of the same unit then
   * counts that lane as skipped. A promotion's limit counts those jobs too.
   */
  promote(queue: string, limit: number): Promise<number>;
  /**
   * The fair take of section 9.5.3 over the lanes of the worker's capability sets: lane caps, keys,
   * FIFO order per key and group limits; reclaims expired leases first (the third consecutive loss
   * makes a job a dead letter, except an action job whose run carries a command id: it is never
   * ended for lost leases, stays takeable and is handed out with `leasesExhausted`, so its taker
   * ends it together with its receipt); only jobs enqueued at or below `maxRevision`, the worker's
   * build revision (section 19.2). `lanes` defaults to `limit`; `skippedLanes` counts lanes locked
   * by other takers, and lanes in which work stayed because another unit holds a row it needs (an
   * expired job's rows, a job's group row, the counter row of a lane whose due job the unit's
   * `promote` left), not "no work". A take never waits behind an open unit: whatever it cannot lock at
   * once stays as it is for a later take (an expired job stays running, a job whose group row is
   * held stays available) and its lane counts as skipped, so the fetcher takes again.
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
  /**
   * Erasure (14.7.5, step 5a): deletes the unit's scope's jobs in every state but `running` that are
   * action jobs of one of `queues` (the command and timer queues) and whose stored principal
   * reference names one of `principalIds`, writing a `cancelled` history row for each (no input, no
   * error; a dead job keeps its `dead` row). A job another principal runs is kept, whoever caused
   * it, and so is every job of another queue. A key's next waiting job is released. Answers the
   * jobs deleted, with what they ran.
   */
  purgeForPrincipals(
    principalIds: readonly string[],
    queues: readonly string[],
  ): Promise<readonly PurgedJob[]>;
  /** Per queue and capability set, from the lane tables (section 21.4). */
  stats(queue?: string): Promise<readonly WorkClassStats[]>;
  /**
   * Whether the unit's reach holds a job of `queue` with `key` that is alive: scheduled, available,
   * waiting or running (a finished or dead job does not count). The restore check asks it before it
   * enqueues the job of an effect again, so a restored job that was running when the backup was
   * taken is not joined by a second one.
   */
  keyed(queue: string, key: string): Promise<boolean>;
  /**
   * The jobs of `queue` in the unit's reach that wait to run (scheduled, available or waiting; never
   * running or dead), counted up to `limit + 1` and no further, so the read is bounded: an answer
   * above `limit` says only "more than `limit`". `validation` (`core.malformed_request`) for a
   * `limit` that is no integer from 0 to 2,147,483,646.
   */
  queued(queue: string, limit: number): Promise<number>;
  /**
   * Retention (14.7.1): deletes `kw_job_history` rows of the unit's scope finished before `before`,
   * lowest job id first, at most `limit`; answers how many it deleted and whether a row finished
   * before `before` is left (`PurgeBatch`). Reads no key and no input. `internal` in a read-only
   * unit and in a namespace-scope unit (it has no job history of one scope; the same refusal as
   * `EventStore.purgeTransient`); `validation` for a limit outside 1..100000.
   */
  purgeHistory(before: Temporal.Instant, limit: number): Promise<PurgeBatch>;
  /** One row per schedule and scope: last tick, next tick (S-118). */
  schedules(): ScheduleStore;
  /**
   * The queues in which this unit made a job takeable, read after the commit like `events.committed()`:
   * a job put in `available` (a due enqueue, a promotion, a key's next job, a reclaimed lease) or a lane
   * slot given back (a completion of any outcome, a cancelled running attempt), or a lane whose cap an
   * enqueue changed (that queue, also when its own job is scheduled for later). `undefined` when the
   * unit cannot name them (a group's slot given back, a group provisioned or a group whose limit an
   * enqueue changed: a group spans queues); `[]` when it made nothing takeable. What a savepoint that
   * failed recorded is taken back.
   */
  readied(): readonly string[] | undefined;
  /**
   * Gives back attempts still running at a drain (21.6 step 4), conditional on (worker, attempt) like
   * `heartbeat`: each goes back to `available`, its attempt not counted (the next take hands it out
   * under the same number), its lost-lease count unchanged, no history row; its lane's `taken` and its
   * group's running slot are given back, a FIFO key keeps it as head. A namespace unit reaches every
   * scope, any other unit its own. Answers the attempts released; one whose lease was lost, or that
   * ended, is not among them, so the late completion of a released attempt answers false. A released
   * job is takeable again: `readied` names its queue, or answers `undefined` (cannot name) when the
   * job is in a group, whose slot another queue may wait for.
   */
  release(attempts: readonly JobAttempt[], worker: string): Promise<readonly JobAttempt[]>;
}
