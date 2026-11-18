import { recordHookEvent } from '../control/record-hook-event.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { RunJobContext } from './run-job.ts';

/** Appends the outcome of a hook job to its tenant's stream in the control store (S-84). */
export function recordHookOutcome(
  context: RunJobContext,
  stored: StoredJob,
  type: 'hookFailed' | 'hookCompleted',
): Promise<void> {
  const { scope } = stored;
  if (scope.level !== 'tenant' || !('action' in stored.run)) return Promise.resolve();
  return recordHookEvent(context.control, scope.tenantId, type, stored.run.action);
}
