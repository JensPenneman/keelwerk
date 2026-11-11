import type { JobCarrier } from '../invoker/job-carrier.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { JobOutcome } from '../storage/job-outcome.ts';
import type { Unit } from '../storage/unit.ts';
import { completeJob } from './complete-job.ts';
import { isCrossScopeJob } from './is-cross-scope-job.ts';

/**
 * Completes the attempt in the unit of the command the job runs, unless that unit is another
 * scope's (`isCrossScopeJob`): the job then stays as it is and its worker completes it afterwards in
 * a unit of the job's own scope.
 */
export async function completeJobHere(
  unit: Unit,
  held: Pick<JobCarrier, 'attempt' | 'worker' | 'scope'>,
  actionScope: ActionEntry['scope'],
  outcome: JobOutcome,
): Promise<void> {
  if (!isCrossScopeJob(held.scope, actionScope)) await completeJob(unit, held, outcome);
}
