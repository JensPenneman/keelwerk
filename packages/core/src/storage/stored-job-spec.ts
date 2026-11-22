import type { JobSpec } from '../jobs/job-spec.ts';

/** What the queue stores: a JobSpec (section 9.5.1) with its kind, its lane's cap and its creation time (section 14.3.9). */
export interface StoredJobSpec extends JobSpec {
  readonly kind: 'action' | 'effect';
  /**
   * `queues.<q>.running` for an upserted lane (section 9.5.2): a whole number from 0 (a lane held:
   * nothing of it is taken) to 2,147,483,647, which a store refuses otherwise with
   * `core.malformed_request`; `checkLaneMembers` is the one check, and a store calls it first.
   */
  readonly laneCap: number;
  /**
   * The weight of the lane an enqueue upserts (section 12.2, `queues.<q>.weight`): a whole number
   * from 1 to 2,147,483,647, which a store refuses otherwise with `core.malformed_request` (the
   * same `checkLaneMembers`); absent: 1 for a new lane, an existing lane keeps its weight. Every
   * enqueue in a tenant's or a backend's scope sets it from the scope's limits (`laneLimitsOf`).
   */
  readonly laneWeight?: number;
  readonly createdAt: Temporal.Instant;
  /**
   * `queues.<q>.queued` of the job's queue in its scope, set by what a request, a decision or a resolver's command job asks for anew (`queuedCapOf`; a resolver's timer carries none), checked at the commit tail of the unit that
   * inserts the job, in whatever state it enters: the unit is refused when it leaves more queued
   * jobs (section 9.5.5) in the queue than the cap. A
   * safe whole number from 0, which a store refuses otherwise with `core.malformed_request`
   * (`checkLaneMembers`). Absent: no cap. An enqueue instruction, never stored: a job of 0.1.0 or
   * 0.2.0 reads as uncapped.
   */
  readonly queuedCap?: number;
}
