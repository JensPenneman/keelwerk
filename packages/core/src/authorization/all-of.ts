import type { Condition } from '../conditions/condition.ts';
import { alwaysCondition } from './always-condition.ts';
import { isAlways } from './is-always.ts';
import { isNever } from './is-never.ts';
import { neverCondition } from './never-condition.ts';

/** The conjunction of conditions, simplified: `never` absorbs, the always-true drops out. */
export function allOf(conditions: readonly Condition[]): Condition {
  const kept: Condition[] = [];
  for (const condition of conditions) {
    if (isNever(condition)) return neverCondition;
    if (isAlways(condition)) continue;
    if (condition.op === 'and') kept.push(...condition.conditions);
    else kept.push(condition);
  }
  const [only] = kept;
  if (only === undefined) return alwaysCondition;
  return kept.length === 1 ? only : { op: 'and', conditions: kept };
}
