import type { Unit } from '../storage/unit.ts';
import type { WrittenRow } from './written-row.ts';

/**
 * The versioned state update of section 15.1.6, step 9: a created row is inserted, every other
 * row is updated with the version the command loaded as expected version (`conflict` otherwise).
 * A `history: 'state'` entity is updated the same way; its events are transient records.
 */
export async function writeStateRows(unit: Unit, written: readonly WrittenRow[]): Promise<void> {
  for (const item of written) {
    if (item.created) {
      await unit.rows.insert(item.entry.descriptor, [item.row]);
    } else {
      await unit.rows.update(item.entry.descriptor, [
        { id: item.id, expectedVersion: item.loadedVersion, values: item.row },
      ]);
    }
  }
}
