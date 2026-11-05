import type { Condition } from '../conditions/condition.ts';
import type { ConditionInput } from '../conditions/condition-input.ts';
import { normalizeCondition } from '../conditions/normalize-condition.ts';
import { invalidArgument } from './invalid-argument.ts';

/** The filter of section 16.4.4: the condition object form, normalised; absent stays absent. */
export function readFilter(value: unknown): Condition | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalidArgument('filter', 'A filter must be an object.');
  }
  return normalizeCondition(value as ConditionInput);
}
