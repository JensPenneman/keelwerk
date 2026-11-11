import type { Job } from '../jobs/job.ts';
import type { JobQueue } from '../jobs/job-queue.ts';
import type { QueueSource } from './queue-source.ts';
import type { WorkersProbe } from './workers-probe.ts';

/** The kernel's queue (9.5.1) with what the runtime and the tests see beyond `JobQueue`. */
export interface KernelQueue extends JobQueue {
  readonly probe: WorkersProbe;
  /** Where a job this queue handed out was taken; `internal` for a foreign job. */
  sourceOf(job: Job): QueueSource;
  /**
   * Binds a kernel service to the probe: `probe.wake()` calls `run`, and `probe.idle()` waits until
   * each promise it answered has settled; the fetchers are woken when one settles.
   */
  attend(run: () => Promise<void>): void;
}
