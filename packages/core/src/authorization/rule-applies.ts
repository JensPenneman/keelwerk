import type { PrincipalKind } from '../principals/principal-kind.ts';
import { actionMatches } from './action-matches.ts';
import type { AuthorizedAction } from './authorized-action.ts';
import type { NormalizedRule } from './normalized-rule.ts';

/**
 * Whether a rule covers an action for a principal kind: its target (the entity, the module's own
 * actions, or a selector across modules), its action list and its principal kinds. A selector
 * with a transport list applies to a deny rule when the transport is unknown, so that a deny never
 * fails open.
 */
export function ruleApplies(
  rule: NormalizedRule,
  action: AuthorizedAction,
  principalKind: PrincipalKind,
  transport: string | null,
): boolean {
  if (rule.entry.disabled) return false;
  if (rule.principals !== null && !rule.principals.has(principalKind)) return false;
  const { target } = rule;
  if (target.kind === 'entity') {
    if (action.entity !== target.ref) return false;
  } else if (target.kind === 'module') {
    if (action.entity !== undefined || action.module !== target.module) return false;
  } else {
    if (target.kinds !== null && !target.kinds.includes(action.kind)) return false;
    if (target.transports !== null) {
      const matches =
        transport === null ? rule.effect === 'deny' : target.transports.includes(transport);
      if (!matches) return false;
    }
  }
  return actionMatches(rule.actions, action);
}
