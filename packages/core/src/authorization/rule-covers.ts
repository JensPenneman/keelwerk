import { actionMatches } from './action-matches.ts';
import type { AuthorizedAction } from './authorized-action.ts';
import type { NormalizedRule } from './normalized-rule.ts';

/**
 * Whether an enabled rule covers an action by its target and its action list alone, whatever the
 * principal, the transport and the input. A selector's transport list is not looked at.
 */
export function ruleCovers(rule: NormalizedRule, action: AuthorizedAction): boolean {
  if (rule.entry.disabled) return false;
  const { target } = rule;
  if (target.kind === 'entity') {
    if (action.entity !== target.ref) return false;
  } else if (target.kind === 'module') {
    if (action.entity !== undefined || action.module !== target.module) return false;
  } else if (target.kinds !== null && !target.kinds.includes(action.kind)) {
    return false;
  }
  return actionMatches(rule.actions, action);
}
