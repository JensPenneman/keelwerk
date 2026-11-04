import type { AuthorizedAction } from './authorized-action.ts';
import type { ExpandedActions } from './expand-action-aliases.ts';

/** Whether a rule's expanded action list names the action (by name or by reference). */
export function actionMatches(actions: ExpandedActions, action: AuthorizedAction): boolean {
  if (actions.all) return true;
  if (actions.names.has(action.name) || actions.names.has(action.ref)) return true;
  return actions.reads && action.kind !== 'command' && action.entity !== undefined;
}
