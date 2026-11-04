import type { ColumnSpec } from '@keelwerk/core';
import type { RawBuilder } from 'kysely';
import { sql } from 'kysely';
import { columnDdlType } from './column-ddl-type.ts';

/** The data type of a column as a Kysely expression (`timestamptz(3)`, `text collate "C"`, `bigint[]`). */
export function columnDataType(column: ColumnSpec): RawBuilder<unknown> {
  return sql.raw(columnDdlType(column));
}
