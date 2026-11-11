import { chainColumns } from '../events/chain-columns.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import type { WrittenRow } from './written-row.ts';

/** The framework columns an `invocation` table does not keep (decision 398). */
const framework: ReadonlySet<string> = new Set([...chainColumns, 'kwErasedAt']);

/** The row as the table of its entity stores it: an invocation table has no `kw_*` columns. */
function storedRow(item: WrittenRow): StorageRow {
  if (item.entry.descriptor.tenancy !== 'invocation') return item.row;
  return Object.fromEntries(Object.entries(item.row).filter(([name]) => !framework.has(name)));
}

/**
 * The versioned state update of section 15.1.6, step 9: a created row is inserted, every other
 * row is updated with the version the command loaded as expected version (`conflict` otherwise).
 * A `history: 'state'` entity is updated the same way; its events are transient records. An entity
 * of invocation tenancy is written without the framework columns its table does not have.
 */
export async function writeStateRows(unit: Unit, written: readonly WrittenRow[]): Promise<void> {
  for (const item of written) {
    if (item.created) {
      await unit.rows.insert(item.entry.descriptor, [storedRow(item)]);
    } else {
      await unit.rows.update(item.entry.descriptor, [
        { id: item.id, expectedVersion: item.loadedVersion, values: storedRow(item) },
      ]);
    }
  }
}
