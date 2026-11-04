import type { Condition } from './condition.ts';
import type { ConditionInput } from './condition-input.ts';
import { normalizeConditionWith } from './normalize-condition-with.ts';

/**
 * Normalises the object form that authors write (section 8.3) to the AST. A comparison whose value
 * is `null` or `undefined`, also inside an `in` or `nin` list, becomes `never`; absence is tested
 * with `isNull`. Several keys or operators form an `and`.
 */
export function normalizeCondition(input: ConditionInput): Condition {
  return normalizeConditionWith(input, false);
}
