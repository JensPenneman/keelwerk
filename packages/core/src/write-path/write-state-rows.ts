import type { Unit } from '../storage/unit.ts';
import { storedRowOf } from './stored-row-of.ts';
import type { WrittenRow } from './written-row.ts';

/**
 * The versioned state update of section 15.1.6, step 9: a created row is inserted, every other
 * row is updated with the version the command loaded as expected version (`conflict` otherwise).
 * A `history: 'state'` entity is updated the same way; its events are transient records. An entity
 * of invocation tenancy is written without the framework columns its table does not have.
 */
export async function writeStateRows(unit: Unit, written: readonly WrittenRow[]): Promise<void> {
  for (const item of written) {
    if (item.created) {
      await unit.rows.insert(item.entry.descriptor, [storedRowOf(item.entry, item.row)]);
    } else {
      await unit.rows.update(item.entry.descriptor, [
        {
          id: item.id,
          expectedVersion: item.loadedVersion,
          values: storedRowOf(item.entry, item.row),
        },
      ]);
    }
  }
}
