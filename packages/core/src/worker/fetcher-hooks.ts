import type { Job } from '../jobs/job.ts';
import type { QueueSource } from './queue-source.ts';

/** What a fetcher tells the kernel queue that owns it. Kernel-internal. */
export interface FetcherHooks {
  /** A job was taken from this source: `sourceOf` answers it from now on. */
  took(job: Job, source: QueueSource): void;
  /** An attempt settled (completed in a unit, given up, retried or lost). */
  settled(): void;
  /** What the probe's `idle` looks at may have changed. */
  changed(): void;
  /** Asks for a tick now. */
  wake(): void;
}
