import type { ColumnSpec } from '@keelwerk/core';
import { errors } from '@keelwerk/core';

const text = 'text';
const collated = 'text collate "C"';

/**
 * The type of a tag column by the query it serves. The registry names a derived column
 * `<field>__<query>` (`__eq`, `__prefix`, `__contains`, `__order`) while section 14.7.9.6 spells the
 * trigram column `__ngram` and the order column `__ore`; both spellings are read (SPEC GAP).
 */
function tagsType(name: string): string {
  if (name.endsWith('__eq')) return 'bytea';
  if (name.endsWith('__contains') || name.endsWith('__ngram')) return 'smallint[]';
  if (name.endsWith('__order') || name.endsWith('__ore')) {
    throw errors.unsupported(`${name}: order tokens need the ore type, which arrives with M5`);
  }
  return 'bigint[]';
}

/**
 * The type `introspect` reports for a column of this spec (section 14.5.1): PostgreSQL's own
 * spelling, with the collation appended where it is not the type's default. A personal field's
 * sealed column is `bytea` and its tag columns are `bytea`, `bigint[]` or `smallint[]` by the query they serve.
 */
export function columnType(column: ColumnSpec): string {
  switch (column.kind) {
    case 'string':
    case 'text':
    case 'subject':
    case 'framework':
      return collated;
    case 'timeZone':
    case 'enum':
    case 'verifier':
      return text;
    case 'integer':
    case 'serial':
      return 'bigint';
    case 'decimal': {
      const { precision, scale } = column.constraints;
      return precision === undefined ? 'numeric' : `numeric(${precision},${scale ?? 0})`;
    }
    case 'float':
      return 'double precision';
    case 'boolean':
      return 'boolean';
    case 'instant':
      return 'timestamp(3) with time zone';
    case 'date':
      return 'date';
    case 'json':
    case 'set':
    case 'list':
    case 'blob':
    case 'secret':
      return 'jsonb';
    case 'ref':
    case 'uuid':
      return 'uuid';
    case 'binary':
    case 'richText':
    case 'sealed':
      return 'bytea';
    case 'tags':
      return tagsType(column.name);
  }
}
