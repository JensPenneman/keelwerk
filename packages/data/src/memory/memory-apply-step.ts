import type { MigrationStep, TableSpec } from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import type { MemoryCollection } from './memory-collection.ts';

function conflict(message: string): KeelwerkError {
  return new KeelwerkError({ kind: 'conflict', code: 'core.conflict', message });
}

function tableNameOf(draft: MemorySchemaDraft, entity: string): string {
  const name = draft.tableOf.get(entity);
  if (name === undefined) throw errors.not_found(`no table was created for ${entity}`);
  return name;
}

function tableOf(draft: MemorySchemaDraft, entity: string): TableSpec {
  const table = draft.tables.get(tableNameOf(draft, entity));
  if (table === undefined) throw errors.not_found(`no table was created for ${entity}`);
  return table;
}

/** Rewrites the rows of every scope of a table; absent values stay absent. */
function rewriteRows(
  draft: MemorySchemaDraft,
  table: string,
  change: (row: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>,
): void {
  for (const [name, collection] of draft.collections) {
    if (!name.startsWith(`rows/${table}/`)) continue;
    const rewritten = new Map<string, unknown>();
    for (const [id, row] of collection) {
      rewritten.set(id, change(row as Readonly<Record<string, unknown>>));
    }
    draft.collections.set(name, rewritten);
  }
}

/** The schema as a migration file changes it: applied to a draft, installed only when every step passed. */
export interface MemorySchemaDraft {
  readonly tables: Map<string, TableSpec>;
  readonly tableOf: Map<string, string>;
  readonly collections: Map<string, MemoryCollection>;
}

/**
 * Applies one neutral step (14.6.2) to the draft: tables, columns, indexes and keys change the
 * catalogue, and the rows follow where a step touches data. Raw SQL has no meaning here, and a
 * rebuild or merge-state step is the kernel's work.
 */
export function memoryApplyStep(draft: MemorySchemaDraft, step: MigrationStep): void {
  switch (step.op) {
    case 'createTable':
      if (draft.tables.has(step.table.name)) throw conflict(`table ${step.table.name} exists`);
      draft.tables.set(step.table.name, step.table);
      draft.tableOf.set(step.entity, step.table.name);
      return;
    case 'dropTable': {
      const name = tableNameOf(draft, step.entity);
      draft.tables.delete(name);
      draft.tableOf.delete(step.entity);
      for (const collection of [...draft.collections.keys()]) {
        if (collection.startsWith(`rows/${name}/`)) draft.collections.delete(collection);
      }
      return;
    }
    case 'addColumn': {
      const table = tableOf(draft, step.entity);
      if (table.columns.some((column) => column.name === step.column.name)) {
        throw conflict(`column ${step.column.name} exists`);
      }
      draft.tables.set(table.name, { ...table, columns: [...table.columns, step.column] });
      return;
    }
    case 'dropColumn': {
      const table = tableOf(draft, step.entity);
      draft.tables.set(table.name, {
        ...table,
        columns: table.columns.filter((column) => column.field !== step.field),
      });
      rewriteRows(draft, table.name, (row) => {
        const { [step.field]: _dropped, ...rest } = row;
        return rest;
      });
      return;
    }
    case 'alterColumn': {
      const table = tableOf(draft, step.entity);
      draft.tables.set(table.name, {
        ...table,
        columns: table.columns.map((column) => (column.name === step.from.name ? step.to : column)),
      });
      return;
    }
    case 'copyColumn': {
      const table = tableOf(draft, step.entity);
      rewriteRows(draft, table.name, (row) =>
        row[step.from] === undefined ? row : { ...row, [step.to]: row[step.from] },
      );
      return;
    }
    case 'createIndex': {
      const table = tableOf(draft, step.entity);
      draft.tables.set(table.name, { ...table, indexes: [...table.indexes, step.index] });
      return;
    }
    case 'dropIndex': {
      const table = tableOf(draft, step.entity);
      draft.tables.set(table.name, {
        ...table,
        indexes: table.indexes.filter((index) => index.name !== step.index.name),
      });
      return;
    }
    case 'addForeignKey': {
      const table = tableOf(draft, step.entity);
      draft.tables.set(table.name, { ...table, foreignKeys: [...table.foreignKeys, step.key] });
      return;
    }
    case 'dropForeignKey': {
      const table = tableOf(draft, step.entity);
      draft.tables.set(table.name, {
        ...table,
        foreignKeys: table.foreignKeys.filter((key) => key.name !== step.key.name),
      });
      return;
    }
    case 'enableMergeState':
    case 'rebuild':
      return;
    case 'sql':
      throw errors.unsupported('the in-memory adapter has no SQL');
  }
}
