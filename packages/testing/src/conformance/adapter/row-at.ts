import type { StorageRow } from '@keelwerk/core';
import { conformanceId } from '@keelwerk/data/conformance';
import { stamp } from './stamp.ts';

/** A row with the system columns for number `n`; `values` adds the entity's own fields. */
export function rowAt(n: number, values: Record<string, unknown> = {}): StorageRow {
  return { id: conformanceId(n), createdAt: stamp, updatedAt: stamp, version: 1, ...values };
}
