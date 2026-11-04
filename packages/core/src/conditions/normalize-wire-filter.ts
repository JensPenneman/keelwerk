import type { Condition } from './condition.ts';
import { normalizeConditionWith } from './normalize-condition-with.ts';

/**
 * Normalises a client filter (section 16.4.4): the object form of section 8.3, except that a bare
 * `null` as a field's value means `isNull: true`. Throws a `validation` error on a malformed filter.
 */
export function normalizeWireFilter(input: unknown): Condition {
  return normalizeConditionWith(input, true);
}
