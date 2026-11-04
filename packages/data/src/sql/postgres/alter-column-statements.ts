import type { MigrationStep } from '@keelwerk/core';
import { sql } from 'kysely';
import { columnDataType } from './column-data-type.ts';
import { columnDdlType } from './column-ddl-type.ts';
import { columnType } from './column-type.ts';
import { constraintName } from './constraint-name.ts';
import { schemaBuilder } from './schema-builder.ts';
import { tableOfEntity } from './table-of-entity.ts';

/**
 * The statements of an `alterColumn` step through Kysely's schema builder: the type (converted
 * with a cast), nullability, the default, and the named length and enum checks, replaced when
 * they change.
 */
export function alterColumnStatements(
  root: string,
  step: Extract<MigrationStep, { op: 'alterColumn' }>,
): readonly string[] {
  const table = tableOfEntity(step.entity);
  const name = step.to.name;
  const schema = schemaBuilder(root);
  const statements: string[] = [];
  if (columnType(step.from) !== columnType(step.to)) {
    const cast = sql`${columnDataType(step.to)} using ${sql.ref(name)}::${sql.raw(columnDdlType(step.to))}`;
    statements.push(
      schema
        .alterTable(table)
        .alterColumn(name, (column) => column.setDataType(cast))
        .compile().sql,
    );
  }
  if (step.from.nullable !== step.to.nullable) {
    statements.push(
      schema
        .alterTable(table)
        .alterColumn(name, (column) =>
          step.to.nullable ? column.dropNotNull() : column.setNotNull(),
        )
        .compile().sql,
    );
  }
  if (step.from.default !== step.to.default) {
    const target = step.to.default;
    statements.push(
      schema
        .alterTable(table)
        .alterColumn(name, (column) =>
          target === null ? column.dropDefault() : column.setDefault(target),
        )
        .compile().sql,
    );
  }
  const before = step.from.constraints;
  const after = step.to.constraints;
  const replaced = (
    suffix: 'len' | 'enum',
    changed: boolean,
    check: ReturnType<typeof sql> | null,
  ): void => {
    if (!changed) return;
    const constraint = constraintName(table, name, suffix);
    statements.push(schema.alterTable(table).dropConstraint(constraint).ifExists().compile().sql);
    if (check !== null) {
      statements.push(schema.alterTable(table).addCheckConstraint(constraint, check).compile().sql);
    }
  };
  replaced(
    'len',
    before.maxLength !== after.maxLength,
    after.maxLength === undefined
      ? null
      : sql`char_length(${sql.ref(name)}) <= ${sql.lit(after.maxLength)}`,
  );
  replaced(
    'enum',
    JSON.stringify(before.values) !== JSON.stringify(after.values),
    after.values === undefined
      ? null
      : sql`${sql.ref(name)} in (${sql.join(after.values.map((value) => sql.lit(value)))})`,
  );
  return statements;
}
