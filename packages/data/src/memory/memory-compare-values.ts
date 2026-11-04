import type { FieldKind } from '@keelwerk/core';
import { compareCodePoints, evaluateCondition } from '@keelwerk/core';

function absent(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * Orders two values of a sort key the way section 14.3.5 defines: absent values are the largest
 * (last ascending, first descending once the direction is applied). Present values are ordered
 * by the condition interpreter itself, so a sort and a `lt`/`gt` filter can never disagree.
 */
export function memoryCompareValues(a: unknown, b: unknown, kind: FieldKind): number {
  if (absent(a)) return absent(b) ? 0 : 1;
  if (absent(b)) return -1;
  if (kind !== 'decimal') {
    if (typeof a === 'string' && typeof b === 'string') return compareCodePoints(a, b);
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  }
  const options = { kindOf: () => kind };
  if (evaluateCondition({ op: 'lt', field: 'v', value: b }, { v: a }, options)) return -1;
  if (evaluateCondition({ op: 'gt', field: 'v', value: b }, { v: a }, options)) return 1;
  return 0;
}
