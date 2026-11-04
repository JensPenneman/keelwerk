import type { StorageRow } from '@keelwerk/core';
import type { EntityTable } from './entity-table.ts';
import { malformedQuery } from './malformed-query.ts';
import { postgresCodecs } from './postgres/postgres-codecs.ts';

/**
 * A state row as the bound values of its columns: absent values (`null`, `undefined`) are left
 * out, every other value goes through its column's codec. A name the entity has no column for is
 * `validation`.
 */
export function sqlEncodeRow(
  table: EntityTable,
  row: StorageRow,
  skip: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const encoded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    if (skip.has(name) || value === null || value === undefined) continue;
    const column = table.column(name);
    if (column === undefined) throw malformedQuery(`${table.entity.ref} has no column ${name}`);
    const codec =
      column.derived === undefined
        ? postgresCodecs.forField(column.field)
        : postgresCodecs.forDerivedIndex(column.derived);
    encoded[column.column] = codec.encode(value);
  }
  return encoded;
}
