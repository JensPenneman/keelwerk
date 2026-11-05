import type { StorageRow } from '../storage/storage-row.ts';

const systemFields: ReadonlySet<string> = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'archivedAt',
  'version',
  'kwLastHlc',
  'kwLastHash',
  'kwErasedAt',
  'tenantId',
  'backendId',
]);

/** A row cut to a field mask: the system fields always stay (the contract of `RowQuery.select`). */
export function projectRow(row: StorageRow, select: readonly string[]): StorageRow {
  return Object.fromEntries(
    Object.entries(row).filter(([name]) => systemFields.has(name) || select.includes(name)),
  );
}
