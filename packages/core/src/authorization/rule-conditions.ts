import type { Condition } from '../conditions/condition.ts';
import { normalizeCondition } from '../conditions/normalize-condition.ts';
import type { PrincipalContext } from '../contexts/principal-context.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { alwaysCondition } from './always-condition.ts';
import { neverCondition } from './never-condition.ts';
import type { NormalizedRule } from './normalized-rule.ts';

function toCondition(rule: NormalizedRule, result: unknown, member: string): Condition {
  if (result === true) return alwaysCondition;
  if (result === false) return neverCondition;
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    try {
      return normalizeCondition(result as Readonly<Record<string, unknown>>);
    } catch (cause) {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `The ${member} of rule "${rule.id}" produced a condition that cannot be evaluated.`,
        cause,
      });
    }
  }
  throw new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: `The ${member} of rule "${rule.id}" must return a condition or a boolean.`,
  });
}

/** The row conditions of a rule for one principal context. */
export interface RuleConditions {
  /** The row acted on; absent `where` is every row. */
  readonly where: Condition;
  /** The row produced; `null` when the rule has none. */
  readonly check: Condition | null;
}

/**
 * Runs the `where` and `check` callbacks of an entity rule and normalises what they return
 * (section 8.3): a boolean is always or never, an object is the author's object form, and an
 * absent `where` selects every row. A callback that throws, or returns something else, is an
 * `internal` error naming the rule, so a deny rule never fails open.
 */
export function ruleConditions(rule: NormalizedRule, context: PrincipalContext): RuleConditions {
  const { entry } = rule;
  let where: Condition = alwaysCondition;
  let check: Condition | null = null;
  try {
    if (entry.where !== undefined) where = toCondition(rule, entry.where(context), 'where');
    if (entry.check !== undefined) check = toCondition(rule, entry.check(context), 'check');
  } catch (cause) {
    if (cause instanceof KeelwerkError) throw cause;
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: `Rule "${rule.id}" failed while it built its condition.`,
      cause,
    });
  }
  return { where, check };
}
