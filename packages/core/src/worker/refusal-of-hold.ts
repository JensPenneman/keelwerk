import { RestoreHoldRefusal } from '../control/restore-hold-refusal.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { RunJobContext } from './run-job.ts';

/**
 * The refusal of the restore hold for a job that runs outside the invoker (an effect job, a
 * deadline job), or `undefined` when its scope is not a held tenant's. An action job meets the hold
 * in the invoker's admission instead.
 */
export async function refusalOfHold(
  context: Pick<RunJobContext, 'restoreHold'>,
  stored: StoredJob,
): Promise<RestoreHoldRefusal | undefined> {
  if (stored.scope.level !== 'tenant') return undefined;
  try {
    await context.restoreHold?.check(stored.scope.tenantId);
  } catch (error) {
    if (error instanceof RestoreHoldRefusal) return error;
    throw error;
  }
  return undefined;
}
