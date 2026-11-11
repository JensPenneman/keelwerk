import type { Job } from '../jobs/job.ts';
import type { JobQueue } from '../jobs/job-queue.ts';
import type { QueueSource } from './queue-source.ts';
import type { WorkersProbe } from './workers-probe.ts';

/** The kernel's queue (9.5.1) with what the runtime and the tests see beyond `JobQueue`. */
export interface KernelQueue extends JobQueue {
  readonly probe: WorkersProbe;
  /** Where a job this queue handed out was taken; `internal` for a foreign job. */
  sourceOf(job: Job): QueueSource;
}
