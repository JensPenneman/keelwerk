import type { Condition } from './condition.ts';
import type { ConditionInput } from './condition-input.ts';
import { normalizeConditionWith } from './normalize-condition-with.ts';

/**
 * Normalises the object form that authors write (section 8.3) to the AST. A comparison whose value
 * is `null` or `undefined` becomes `never`; absence is tested with `isNull`. A `null` or `undefined`
 * inside an `in` or `nin` list is rejected with `core.internal` (a rule produced it). Several keys or operators form an `and`.
 */
export function normalizeCondition(input: ConditionInput): Condition {
  return normalizeConditionWith(input, false);
}
