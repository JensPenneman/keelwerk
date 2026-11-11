import type { Condition } from '../conditions/condition.ts';
import { normalizeWireFilter } from '../conditions/normalize-wire-filter.ts';
import { invalidArgument } from './invalid-argument.ts';

/** The filter of section 16.4.4: the condition object form of the wire (a bare `null` is `isNull`), normalised; absent stays absent. */
export function readFilter(value: unknown): Condition | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalidArgument('filter', 'A filter must be an object.');
  }
  return normalizeWireFilter(value);
}
