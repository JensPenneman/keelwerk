import type { JobCarrier } from '../invoker/job-carrier.ts';
import type { JobOutcome } from '../storage/job-outcome.ts';
import type { Unit } from '../storage/unit.ts';
import { jobLeaseLost } from './job-lease-lost.ts';

/**
 * Completes the attempt in the unit the caller holds (9.5.4), conditional on (worker, attempt). A
 * lost lease throws `core.job_lease_lost`, so the unit rolls back with everything it wrote and the
 * attempt that lost its lease changes nothing.
 */
export async function completeJob(
  unit: Unit,
  held: Pick<JobCarrier, 'attempt' | 'worker'>,
  outcome: JobOutcome,
): Promise<void> {
  if (await unit.jobs.complete(held.attempt, held.worker, outcome)) return;
  throw jobLeaseLost();
}
