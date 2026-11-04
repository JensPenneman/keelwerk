import type { IndexSpec } from '@keelwerk/core';
import type { SqlBool } from 'kysely';
import { sql } from 'kysely';
import { renderIndexPredicate } from './render-index-predicate.ts';
import { schemaBuilder } from './schema-builder.ts';

/** `create index` for an index of a table in the namespace root, through Kysely's schema builder. */
export function createIndexStatement(root: string, table: string, index: IndexSpec): string {
  let builder = schemaBuilder(root)
    .createIndex(index.name)
    .on(table)
    .using(index.method)
    .columns([...index.columns]);
  if (index.unique) builder = builder.unique();
  if (index.where !== null)
    builder = builder.where(sql.raw<SqlBool>(renderIndexPredicate(index.where)));
  return builder.compile().sql;
}
