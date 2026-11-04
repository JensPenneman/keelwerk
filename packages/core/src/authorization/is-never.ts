import type { Condition } from '../conditions/condition.ts';

/** True for the condition no row meets (`never`, an empty `or`). */
export function isNever(condition: Condition): boolean {
  return condition.op === 'never' || (condition.op === 'or' && condition.conditions.length === 0);
}
