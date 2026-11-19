import type { JobSpec } from '../jobs/job-spec.ts';

/** What the queue stores: a JobSpec (section 9.5.1) with its kind, its lane's cap and its creation time (section 14.3.9). */
export interface StoredJobSpec extends JobSpec {
  readonly kind: 'action' | 'effect';
  /** `queues.<q>.running` for an upserted lane (section 9.5.2). */
  readonly laneCap: number;
  /**
   * `queues.<q>.weight` for an upserted lane (section 12.2); absent: 1 for a new lane, an existing
   * lane keeps its weight.
   */
  readonly laneWeight?: number;
  readonly createdAt: Temporal.Instant;
}
