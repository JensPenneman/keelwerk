import type { StreamAppend } from '../events/stream-append.ts';
import type { Unit } from '../storage/unit.ts';
import type { WrittenRow } from './written-row.ts';

/** The partition an event of the row belongs to: the value of the entity's partition field. */
function partitionOf(item: WrittenRow): string | null {
  const field = item.entry.descriptor.partition;
  const value = field === null ? undefined : item.row[field];
  return value === undefined || value === null ? null : String(value);
}

/**
 * Buffers the events of every written row, one batch per stream with the loaded version as
 * expected version (section 15.1.6, step 9); the commit tail assigns positions. A stream that
 * moved since the load is `conflict` `core.version_mismatch`.
 */
export async function appendEvents(unit: Unit, written: readonly WrittenRow[]): Promise<void> {
  const batch: StreamAppend[] = written
    .filter((item) => item.events.length > 0)
    .map((item) => ({
      stream: { type: item.entry.ref, id: item.id },
      expectedVersion: item.loadedVersion,
      partition: partitionOf(item),
      events: item.events,
    }));
  if (batch.length > 0) await unit.events.append(batch);
}
