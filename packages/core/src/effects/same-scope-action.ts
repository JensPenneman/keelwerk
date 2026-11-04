import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Scope } from '../storage/scope.ts';

/**
 * Refuses a command whose scope level is not the unit's: no unit spans two scopes (section 14.3.6),
 * and the job store takes a job in a unit of its own scope. Work of another scope has no path in
 * this release (section 12.3). SPEC GAP against 7.9.5 ("any scope") and 12.3 (another scope runs through an
 * enqueue effect): the lead decides on a post-commit enqueue in a short unit of the target scope.
 */
export function sameScopeAction(scope: Scope, action: ActionEntry, effect: string): void {
  if (action.scope === scope.level) return;
  throw refuseRequest(
    `${effect} of "${action.ref}"`,
    `the command runs at the ${action.scope} level and this unit is at the ${scope.level} level; commands of another scope have no path in this release`,
  );
}
