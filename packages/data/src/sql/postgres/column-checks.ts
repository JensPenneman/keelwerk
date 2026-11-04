import type { ColumnSpec } from '@keelwerk/core';
import type { Expression } from 'kysely';
import { sql } from 'kysely';
import { constraintName } from './constraint-name.ts';

/** A named check constraint a column carries. */
export interface ColumnCheck {
  readonly name: string;
  readonly expression: Expression<unknown>;
}

/** The checks a `maxLength` or an enum adds to a column, named so a later step can replace them. */
export function columnChecks(table: string, column: ColumnSpec): readonly ColumnCheck[] {
  const { maxLength, values } = column.constraints;
  const checks: ColumnCheck[] = [];
  if (column.kind === 'string' && maxLength !== undefined) {
    checks.push({
      name: constraintName(table, column.name, 'len'),
      expression: sql`char_length(${sql.ref(column.name)}) <= ${sql.lit(maxLength)}`,
    });
  }
  if (column.kind === 'enum' && values !== undefined) {
    checks.push({
      name: constraintName(table, column.name, 'enum'),
      expression: sql`${sql.ref(column.name)} in (${sql.join(values.map((value) => sql.lit(value)))})`,
    });
  }
  return checks;
}
