import { chainColumns } from '../events/chain-columns.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';

/** The framework columns an `invocation` table does not keep (decision 398). */
const framework: ReadonlySet<string> = new Set([...chainColumns, 'kwErasedAt']);

/** The row as its table stores it: an invocation table has no chain columns and no kwErasedAt (decision 398). */
export function storedRowOf(entry: EntityEntry, row: StorageRow): StorageRow {
  if (entry.descriptor.tenancy !== 'invocation') return row;
  return Object.fromEntries(Object.entries(row).filter(([name]) => !framework.has(name)));
}
