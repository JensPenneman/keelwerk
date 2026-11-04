import type { MigrationStep } from '@keelwerk/core';
import { errors, physicalColumnName } from '@keelwerk/core';
import { alterColumnStatements } from './alter-column-statements.ts';
import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { columnChecks } from './column-checks.ts';
import { columnDataType } from './column-data-type.ts';
import { createIndexStatement } from './create-index-statement.ts';
import { createTableStatements } from './create-table-statements.ts';
import { defineColumn } from './define-column.ts';
import { quoteIdentifier } from './quote-identifier.ts';
import { schemaBuilder } from './schema-builder.ts';
import { tableOfEntity } from './table-of-entity.ts';
import { tablePolicyDdl } from './table-policy-ddl.ts';

/** What rendering a step needs besides the step. */
export interface RenderContext {
  /** The role that reads and writes the entity tables the step creates; none: no grant. */
  readonly role?: string;
}

/**
 * The PostgreSQL statements of one neutral step in the namespace root `root` (section 14.6.2),
 * one per entry. Tables, columns, indexes and constraints render through Kysely's schema builder;
 * row-level security, grants and the backfill are written out, since the builder has no such
 * statements. A `dropColumn` drops the one column its `field` names: a field's own column by the
 * field's name, a derived column (a tag column, a CRDT value column) by its physical name. A new
 * table also gets its indexes, its forced row-level security with the `scoped` and `maintenance` policies, and a grant to the context's role. `rebuild` is a comment:
 * the kernel re-projects from the log, the database has nothing to run. An `sql` step without
 * PostgreSQL statements and a step of a later milestone fail closed.
 */
export function renderStep(
  root: string,
  step: MigrationStep,
  context: RenderContext = {},
): readonly string[] {
  const schema = assertNamespaceRoot(root);
  const on = (entity: string): string =>
    `${quoteIdentifier(schema)}.${quoteIdentifier(tableOfEntity(entity))}`;
  const builder = schemaBuilder(schema);
  switch (step.op) {
    case 'createTable':
      return [
        ...createTableStatements(schema, step.table),
        ...tablePolicyDdl(schema, step.table.name, step.table.scoped),
        ...(context.role === undefined
          ? []
          : [
              `grant select, insert, update, delete on ${quoteIdentifier(schema)}.${quoteIdentifier(step.table.name)} to ${quoteIdentifier(context.role)}`,
            ]),
      ];
    case 'dropTable':
      return [builder.dropTable(tableOfEntity(step.entity)).ifExists().compile().sql];
    case 'addColumn': {
      const name = tableOfEntity(step.entity);
      return [
        builder
          .alterTable(name)
          .addColumn(step.column.name, columnDataType(step.column), defineColumn(step.column))
          .compile().sql,
        ...columnChecks(name, step.column).map(
          (check) =>
            builder.alterTable(name).addCheckConstraint(check.name, check.expression).compile().sql,
        ),
      ];
    }
    case 'dropColumn':
      return [
        builder
          .alterTable(tableOfEntity(step.entity))
          .dropColumn(physicalColumnName(step.field), (drop) => drop.ifExists())
          .compile().sql,
      ];
    case 'alterColumn':
      return alterColumnStatements(schema, step);
    case 'copyColumn': {
      const from = quoteIdentifier(physicalColumnName(step.from));
      const to = quoteIdentifier(physicalColumnName(step.to));
      return [
        `update ${on(step.entity)} set ${to} = ${from} where ${to} is null and ${from} is not null`,
      ];
    }
    case 'createIndex':
      return [createIndexStatement(schema, tableOfEntity(step.entity), step.index)];
    case 'dropIndex':
      return [builder.dropIndex(step.index.name).ifExists().compile().sql];
    case 'addForeignKey':
      return [
        builder
          .alterTable(tableOfEntity(step.entity))
          .addForeignKeyConstraint(
            step.key.name,
            [...step.key.columns],
            step.key.references.table,
            [...step.key.references.columns],
          )
          .compile().sql,
      ];
    case 'dropForeignKey':
      return [
        builder
          .alterTable(tableOfEntity(step.entity))
          .dropConstraint(step.key.name)
          .ifExists()
          .compile().sql,
      ];
    case 'rebuild':
      return [`-- rebuild ${step.entity}: ${step.reason.replaceAll(/[\r\n]+/g, ' ')}`];
    case 'enableMergeState':
      throw errors.unsupported('merge state arrives with offline sync (M6)');
    case 'sql': {
      const statements = step.statements.postgres;
      if (statements === undefined) {
        throw errors.unsupported('an sql step carries no statements for postgres');
      }
      return statements;
    }
  }
}
