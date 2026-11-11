import type { ActionEntry } from '../registry/action-entry.ts';
import type { Scope } from '../storage/scope.ts';

/**
 * Whether a job runs its command in another scope's unit than the one it lives in (D1, decision
 * 345): a tenant's job that runs a backend command. The invoker runs that command in the tenant's
 * own backend unit, so the command's unit cannot complete the job, which stays in the tenant's lane:
 * the worker completes it afterwards in a unit of the job's own scope. A repeated run is harmless,
 * because the command's receipt (its kernel command id) in the backend scope replays.
 */
export function isCrossScopeJob(jobScope: Scope, actionScope: ActionEntry['scope']): boolean {
  return jobScope.level === 'tenant' && actionScope === 'backend';
}
