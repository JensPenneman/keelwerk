import type { StoredJobSpec } from '@keelwerk/core';

/** The states of `kw_jobs.state` (9.5.2). */
type MemoryJobState = 'scheduled' | 'available' | 'waiting' | 'running' | 'dead';

/** One row of `kw_jobs`; the spec is kept whole, priority and capability set also belong to the lane. */
export interface MemoryJob {
  readonly id: number;
  readonly scopeId: string;
  readonly laneKey: string;
  readonly spec: StoredJobSpec;
  readonly state: MemoryJobState;
  readonly runAt: Temporal.Instant;
  readonly worker: string | null;
  readonly attempt: number;
  readonly leaseUntil: Temporal.Instant | null;
  /** Consecutive lost leases; three make a dead letter (9.5.4). */
  readonly lostLeases: number;
  readonly startedAt: Temporal.Instant | null;
}
