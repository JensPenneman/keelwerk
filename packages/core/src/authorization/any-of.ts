import type { Condition } from '../conditions/condition.ts';
import { alwaysCondition } from './always-condition.ts';
import { isAlways } from './is-always.ts';
import { isNever } from './is-never.ts';
import { neverCondition } from './never-condition.ts';

/** The disjunction of conditions, simplified: the always-true absorbs, `never` drops out. */
export function anyOf(conditions: readonly Condition[]): Condition {
  const kept: Condition[] = [];
  for (const condition of conditions) {
    if (isAlways(condition)) return alwaysCondition;
    if (isNever(condition)) continue;
    if (condition.op === 'or') kept.push(...condition.conditions);
    else kept.push(condition);
  }
  const [only] = kept;
  if (only === undefined) return neverCondition;
  return kept.length === 1 ? only : { op: 'or', conditions: kept };
}
