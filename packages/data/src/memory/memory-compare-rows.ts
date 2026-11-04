import type { StorageRow } from '@keelwerk/core';
import type { SortKey } from '../sql/compile-sort.ts';
import { memoryCompareValues } from './memory-compare-values.ts';

/** Orders two rows by the sort keys (which end with `id`), directions applied. */
export function memoryCompareRows(keys: readonly SortKey[], a: StorageRow, b: StorageRow): number {
  for (const key of keys) {
    const sign = memoryCompareValues(a[key.field], b[key.field], key.column.field.kind);
    if (sign !== 0) return key.direction === 'asc' ? sign : -sign;
  }
  return 0;
}
