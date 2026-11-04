import type { WireError } from '@keelwerk/core';

/** One row of `kw_job_history`: no input, ever. */
export interface MemoryHistory {
  readonly scopeId: string;
  readonly jobId: string;
  readonly queue: string;
  readonly kind: 'action' | 'effect';
  readonly outcome: 'succeeded' | 'failed' | 'dead' | 'cancelled';
  readonly attempts: number;
  readonly startedAt: Temporal.Instant | null;
  readonly finishedAt: Temporal.Instant;
  readonly error: WireError | null;
}
