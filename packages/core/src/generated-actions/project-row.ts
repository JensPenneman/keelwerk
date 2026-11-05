import type { StorageRow } from '../storage/storage-row.ts';

/** `fields` limits the members of a row; `id` and `version` always stay (section 16.4.5). */
export function projectRow(row: StorageRow, fields: readonly string[] | undefined): StorageRow {
  if (fields === undefined) return row;
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    if (name === 'id' || name === 'version' || name === '$masked' || fields.includes(name)) {
      kept[name] = value;
    }
  }
  return kept;
}
