import type { ColumnSpec } from '@keelwerk/core';
import { columnType } from './column-type.ts';

/** The type of a column as DDL spells it: `timestamptz(3)` for the timestamp. */
export function columnDdlType(column: ColumnSpec): string {
  return columnType(column).replace('timestamp(3) with time zone', 'timestamptz(3)');
}
