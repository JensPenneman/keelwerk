import type { TableSpec } from '@keelwerk/core';
import type { CreateTableBuilder } from 'kysely';
import { columnChecks } from './column-checks.ts';
import { columnDataType } from './column-data-type.ts';
import { createIndexStatement } from './create-index-statement.ts';
import { defineColumn } from './define-column.ts';
import { schemaBuilder } from './schema-builder.ts';

/**
 * `create table` through Kysely's schema builder: the columns with their checks and the primary
 * key, then the table's indexes.
 */
export function createTableStatements(root: string, table: TableSpec): readonly string[] {
  let builder: CreateTableBuilder<string, string> = schemaBuilder(root).createTable(table.name);
  for (const column of table.columns) {
    builder = builder.addColumn(column.name, columnDataType(column), defineColumn(column));
  }
  for (const column of table.columns) {
    for (const check of columnChecks(table.name, column)) {
      builder = builder.addCheckConstraint(check.name, check.expression);
    }
  }
  builder = builder.addPrimaryKeyConstraint(`${table.name}_pkey`, [...table.primaryKey]);
  return [
    builder.compile().sql,
    ...table.indexes.map((index) => createIndexStatement(root, table.name, index)),
  ];
}
