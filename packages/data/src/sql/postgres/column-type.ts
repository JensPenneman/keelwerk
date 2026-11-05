import type { ColumnSpec } from '@keelwerk/core';
import { errors } from '@keelwerk/core';

const text = 'text';
const collated = 'text collate "C"';

/**
 * The type of a tag column by the derived index field it carries (section 14.7.9.6): a blind index
 * tag is `bytea`, trigram tags `smallint[]`, prefix and token tags `bigint[]`.
 */
function tagsType(column: ColumnSpec): string {
  const derived = column.derived;
  if (derived === undefined) {
    throw errors.internal(`${column.name}: a tag column names the index it answers`);
  }
  switch (derived.kind) {
    case 'binary':
      return 'bytea';
    case 'ore':
      throw errors.unsupported(
        `${column.name}: order tokens need the ore type, which arrives with M5`,
      );
    case 'tagSet':
      return derived.query === 'contains' ? 'smallint[]' : 'bigint[]';
  }
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
      return tagsType(column);
  }
}
