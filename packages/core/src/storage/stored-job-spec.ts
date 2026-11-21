import type { JobSpec } from '../jobs/job-spec.ts';

/** What the queue stores: a JobSpec (section 9.5.1) with its kind, its lane's cap and its creation time (section 14.3.9). */
export interface StoredJobSpec extends JobSpec {
  readonly kind: 'action' | 'effect';
  /** `queues.<q>.running` for an upserted lane (section 9.5.2). */
  readonly laneCap: number;
  readonly createdAt: Temporal.Instant;
  /**
   * `queues.<q>.queued` of a command job's scope, checked at the enqueue's commit tail; absent: no
   * cap. An enqueue instruction, never stored: a job of 0.1.0 or 0.2.0 reads as uncapped.
   */
  readonly queuedCap?: number;
}
