import type { Condition } from '../conditions/condition.ts';
import { alwaysCondition } from './always-condition.ts';
import { isAlways } from './is-always.ts';
import { isNever } from './is-never.ts';
import { neverCondition } from './never-condition.ts';

/** The negation of a condition, simplified. */
export function negate(condition: Condition): Condition {
  if (isAlways(condition)) return neverCondition;
  if (isNever(condition)) return alwaysCondition;
  if (condition.op === 'not') return condition.condition;
  return { op: 'not', condition };
}
