import type { Condition } from '../conditions/condition.ts';

/** True for the condition every row meets (an empty `and`). */
export function isAlways(condition: Condition): boolean {
  return condition.op === 'and' && condition.conditions.length === 0;
}
