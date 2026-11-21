import type { StoredJob } from '../storage/stored-job.ts';
import { lostLeaseWireError } from './lost-lease-wire-error.ts';
import type { RunJobContext } from './run-job.ts';
import { settleJobAttempt } from './settle-job-attempt.ts';

/**
 * Ends a job whose leases were lost too often (`StoredJob.leasesExhausted`, 9.5.4) without running
 * it again: a dead letter with the error of a lost lease, in the one unit that also fails the job's
 * own `accepted` receipt (`settleJobAttempt`). The store never ends such a job for lost leases, so
 * no lost lease ends a command job without settling its receipt in the same commit (D7). A unit
 * that fails leaves the attempt to its lease, and the next take after the lease hands the job out
 * again: the job stays takeable until this unit commits.
 */
export function settleExhaustedJob(
  context: Pick<RunJobContext, 'source' | 'worker' | 'writer' | 'clock'>,
  stored: StoredJob,
): Promise<void> {
  return settleJobAttempt(context, stored, { kind: 'dead', error: lostLeaseWireError });
}
