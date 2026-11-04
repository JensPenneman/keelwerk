import { compareCodePoints } from '../conditions/compare-code-points.ts';
import { evaluateCondition } from '../conditions/evaluate-condition.ts';
import type { FieldKind } from '../storage/field-kind.ts';

function absent(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * Orders two values of a sort key as section 14.3.5 defines: absent values are the largest, and
 * present values are ordered by the condition interpreter, so a sort and a `lt`/`gt` filter agree.
 */
export function compareSortValues(a: unknown, b: unknown, kind: FieldKind | undefined): number {
  if (absent(a)) return absent(b) ? 0 : 1;
  if (absent(b)) return -1;
  if (kind !== 'decimal') {
    if (typeof a === 'string' && typeof b === 'string') return compareCodePoints(a, b);
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  }
  const options = kind === undefined ? {} : { kindOf: () => kind };
  if (evaluateCondition({ op: 'lt', field: 'v', value: b }, { v: a }, options)) return -1;
  if (evaluateCondition({ op: 'gt', field: 'v', value: b }, { v: a }, options)) return 1;
  return 0;
}
