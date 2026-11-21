import type { KernelQueue } from '@keelwerk/core';

/** A kernel queue of a scenario with the hooks a case needs to pause it and to watch its renewals. */
export interface QueueScenarioWorker {
  readonly id: string;
  readonly queue: KernelQueue;
  /** Lease renewals the store granted to this worker so far. */
  renewals(): number;
  /** From now on every `jobs.heartbeat` of this worker rejects with errors.unavailable (a paused or partitioned worker) until `heal`. */
  cut(): void;
  heal(): void;
  /** The `drain` of this worker's `work` handle. */
  drain(deadline: Temporal.Instant): Promise<number>;
}
