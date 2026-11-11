import type { Job } from '../jobs/job.ts';
import type { QueueSource } from './queue-source.ts';

/** An attempt a worker of this process runs: what its renewals, its expiry and its settlement need. Kernel-internal. */
export interface HeldJob {
  readonly job: Job;
  readonly source: QueueSource;
  /** Aborts the attempt's `Job.signal`. */
  readonly abort: AbortController;
  /** `heartbeatSeconds` (default 10) in milliseconds, and three times that: the lease a renewal asks for. */
  readonly heartbeatMs: number;
  readonly leaseMs: number;
  /** The take's clock instant plus `expireInSeconds`. */
  readonly expiresAt: Temporal.Instant | undefined;
  /** The last renewal on the runtime clock: the take, or one heartbeat earlier when `heartbeatMs` is not 10 000 (renewed at the next tick). */
  renewedAt: Temporal.Instant;
}
