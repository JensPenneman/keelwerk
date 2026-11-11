import type { ControlStore } from '../control/control-store.ts';
import { errors } from '../errors/errors.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Job } from '../jobs/job.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { QueueSource } from './queue-source.ts';
import { runActionJob } from './run-action-job.ts';

/** What a worker runs a job with. */
export interface RunJobContext {
  readonly invoker: Invoker;
  /** The fencing id: the process id. */
  readonly worker: string;
  /** Where the job was taken. */
  readonly source: QueueSource;
  readonly writer: ControlStore['writer'];
  readonly clock: Clock;
  readonly random: () => number;
  readonly log: Logger;
}

/**
 * Runs one job (the seam of F-32): an action job goes through the invoker; an executor job has no
 * runner until effect executors land, so it fails `unavailable` and the queue retries it by its
 * policy.
 */
export function runJob(job: Job, context: RunJobContext): Promise<void> {
  if ('action' in job.stored.run) return runActionJob(job, context);
  return Promise.reject(errors.unavailable('Effect executors do not run in this release.'));
}
