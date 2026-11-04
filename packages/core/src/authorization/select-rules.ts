import type { PrincipalContext } from '../contexts/principal-context.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { AuthorizedAction } from './authorized-action.ts';
import type { NormalizedRule } from './normalized-rule.ts';
import { ruleApplies } from './rule-applies.ts';

/**
 * The rules in effect for an action, a principal context and an input: they cover the action and
 * the principal kind, and their `when`, when they have one, holds (an absent `when` holds).
 */
export function selectRules(
  rules: readonly NormalizedRule[],
  action: AuthorizedAction,
  context: PrincipalContext,
  transport: string | null,
  input: unknown,
): readonly NormalizedRule[] {
  const selected: NormalizedRule[] = [];
  for (const rule of rules) {
    if (!ruleApplies(rule, action, context.principal.kind, transport)) continue;
    const { when } = rule.entry;
    if (when !== undefined) {
      let holds: boolean;
      try {
        holds = when(context, input) === true;
      } catch (cause) {
        throw new KeelwerkError({
          kind: 'internal',
          code: 'core.internal',
          message: `Rule "${rule.id}" failed while it evaluated its when.`,
          cause,
        });
      }
      if (!holds) continue;
    }
    selected.push(rule);
  }
  return selected.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
