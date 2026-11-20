import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { AuthorizedAction } from './authorized-action.ts';
import type { NormalizedRule } from './normalized-rule.ts';
import { ruleCovers } from './rule-covers.ts';

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
  if (!ruleCovers(rule, action)) return false;
  if (rule.principals !== null && !rule.principals.has(principalKind)) return false;
  const { target } = rule;
  if (target.kind === 'selector' && target.transports !== null) {
    return transport === null ? rule.effect === 'deny' : target.transports.includes(transport);
  }
  return true;
}
