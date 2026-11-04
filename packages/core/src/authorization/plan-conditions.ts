import type { Condition } from '../conditions/condition.ts';
import type { Plan } from './plan.ts';

/** Every condition a plan holds, for a caller that prefetches relation answers. */
export function planConditions(plan: Plan): readonly Condition[] {
  const conditions: Condition[] = [plan.where];
  for (const clause of [...plan.allows, ...plan.denies, ...plan.fieldDenies]) {
    conditions.push(clause.where);
    if (clause.check !== null) conditions.push(clause.check);
  }
  return conditions;
}
