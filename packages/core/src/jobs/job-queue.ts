import type { JobId } from '../storage/job-id.ts';
import type { Unit } from '../storage/unit.ts';
import type { WorkClassStats } from '../storage/work-class-stats.ts';
import type { Job } from './job.ts';
import type { JobExplanation } from './job-explanation.ts';
import type { JobSpec } from './job-spec.ts';
import type { QueueCapabilities } from './queue-capabilities.ts';
import type { WorkerOptions } from './worker-options.ts';

/** The deployment point `queue` (sections 5.6 and 9.5.1); WP-80 builds the kernel queue. */
export interface JobQueue {
  readonly capabilities: QueueCapabilities;
  enqueue(job: JobSpec, unit: Unit): Promise<JobId>;
  /** Cancels the pending jobs of the key; a running attempt only in the timers queue (see `JobStore.cancel`); outside it a running job is left to finish and is not counted. Answers a count only. */
  cancel(queue: string, key: string, unit: Unit): Promise<number>;
  work(
    queue: string,
    handler: (job: Job) => Promise<void>,
    options: WorkerOptions,
  ): Promise<{ drain(deadline: Temporal.Instant): Promise<number> }>;
  schedule(
    id: string,
    expression: string,
    job: Omit<JobSpec, 'runAt' | 'scope' | 'principal'>,
    fanOut: 'backend' | 'each-tenant',
  ): Promise<void>;
  /** Section 21.4. */
  stats(selector: {
    readonly queue?: string;
    readonly backendId?: string;
  }): Promise<readonly WorkClassStats[]>;
  explain(job: JobId): Promise<JobExplanation>;
}
