import type { StorageRow } from '@keelwerk/core';
import { memoryCloneValue } from './memory-clone-value.ts';

/** A copy of the named columns that the row holds; absent values are left out, as a query leaves them. */
export function memoryProjectRow(row: StorageRow, names: readonly string[]): StorageRow {
  const copy: Record<string, unknown> = {};
  for (const name of names) {
    const value = row[name];
    if (value !== null && value !== undefined) copy[name] = memoryCloneValue(value);
  }
  return copy;
}
