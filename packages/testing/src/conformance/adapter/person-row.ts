import type { StorageRow } from '@keelwerk/core';
import { conformanceId } from '@keelwerk/data/conformance';

const stamp = Temporal.Instant.from('2026-01-01T00:00:00Z');

/** A `conf.person` row numbered `index`: its id is fixed by position, so any scope can hold it. */
export function personRow(index: number, values: Record<string, unknown>): StorageRow {
  return {
    id: conformanceId(1000 + index),
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    ...values,
  };
}
