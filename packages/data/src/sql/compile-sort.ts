import type { RowQuery } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import type { Expression } from 'kysely';
import { sql } from 'kysely';
import type { ColumnRef, EntityTable } from './entity-table.ts';
import type { DialectCodecs, ValueCodec } from './value-codec.ts';

const unorderableKinds: ReadonlySet<string> = new Set([
  'json',
  'richText',
  'blob',
  'set',
  'list',
  'secret',
  'verifier',
  'binary',
]);

function unsortable(field: string, reason: string, personal: boolean): KeelwerkError {
  return new KeelwerkError(
    personal
      ? {
          kind: 'unsupported',
          code: 'core.personal_operator',
          message: `cannot sort by the personal field ${field}: ${reason}`,
          details: { op: 'sort', field, reason },
        }
      : {
          kind: 'validation',
          code: 'core.malformed_request',
          message: `cannot sort by ${field}: ${reason}`,
          details: { op: 'sort', field, reason },
        },
  );
}

/** One resolved sort key. */
export interface SortKey {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
  readonly column: ColumnRef;
  readonly codec: ValueCodec;
}

/** A sort that ends with `id`, ready to become an `ORDER BY` in either direction. */
export interface CompiledSort {
  /** The requested keys, then `id` ascending when the request did not name it. */
  readonly keys: readonly SortKey[];
  /** The `ORDER BY` items; `reverse` flips every direction (for `last` and `before`). */
  orderBy(reverse: boolean, reference?: (key: SortKey) => string): readonly Expression<unknown>[];
}

/**
 * Resolves a sort against an entity's columns (section 14.3.5). The sort always ends with `id`
 * (ascending unless named), so keyset paging is total. Ascending puts absent values last
 * (`NULLS LAST`), descending first (`NULLS FIRST`), compiled explicitly; the in-memory adapter
 * mirrors it. Fields whose kind has no order, and personal fields (no order tokens before M5),
 * are refused.
 */
export function compileSort(
  table: EntityTable,
  sort: RowQuery['sort'],
  codecs: DialectCodecs,
): CompiledSort {
  const keys: SortKey[] = [];
  for (const item of sort ?? []) {
    // Keys after `id` cannot break a tie: ids are unique.
    if (keys.some((key) => key.field === 'id')) break;
    const column = table.column(item.field);
    if (column === undefined) {
      throw unsortable(item.field, `${table.entity.ref} has no such field`, false);
    }
    if (column.field.personal !== false) {
      throw unsortable(item.field, 'order tokens are not available before M5', true);
    }
    if (unorderableKinds.has(column.field.kind)) {
      throw unsortable(item.field, `${column.field.kind} fields have no order`, false);
    }
    if (keys.some((key) => key.field === item.field)) {
      throw unsortable(item.field, 'the field is named twice', false);
    }
    keys.push({
      field: item.field,
      direction: item.direction,
      column,
      codec: codecs.forField(column.field),
    });
  }
  if (!keys.some((key) => key.field === 'id')) {
    const column = table.column('id');
    if (column === undefined) throw unsortable('id', 'the entity has no id', false);
    keys.push({ field: 'id', direction: 'asc', column, codec: codecs.forField(column.field) });
  }
  return {
    keys,
    orderBy: (reverse, reference) =>
      keys.map((key) => {
        const ascending = (key.direction === 'asc') !== reverse;
        const column = sql.ref(reference?.(key) ?? table.reference(key.column.column));
        return ascending ? sql`${column} asc nulls last` : sql`${column} desc nulls first`;
      }),
  };
}
