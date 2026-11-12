import type { JobRun } from '../jobs/job-run.ts';

/**
 * A job an erasure purged (`JobStore.purgeForPrincipals`): the queue it was in and what it ran,
 * which still holds the sealed members of its input, so the kernel can destroy the value keys the
 * secret members were sealed under.
 */
export interface PurgedJob {
  readonly queue: string;
  readonly run: JobRun;
}
