import type { ColumnSpec } from '@keelwerk/core';
import type { ColumnDefinitionBuilder } from 'kysely';
import { sql } from 'kysely';

const clocked = new Set(['created_at', 'updated_at']);

/**
 * What a column adds to its `create table` or `add column` (section 14.5.1): `not null` and a
 * literal default (`now()` for the two system timestamps).
 */
export function defineColumn(
  column: ColumnSpec,
): (builder: ColumnDefinitionBuilder) => ColumnDefinitionBuilder {
  return (builder) => {
    let defined = builder;
    if (!column.nullable) defined = defined.notNull();
    if (column.field === null && clocked.has(column.name)) defined = defined.defaultTo(sql`now()`);
    else if (column.default !== null) defined = defined.defaultTo(column.default);
    return defined;
  };
}
