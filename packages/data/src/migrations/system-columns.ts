import type { ColumnSpec } from '@keelwerk/core';

function column(
  name: string,
  kind: ColumnSpec['kind'],
  nullable: boolean,
  defaultValue: ColumnSpec['default'] = null,
): ColumnSpec {
  return { name, field: null, kind, nullable, default: defaultValue, constraints: {} };
}

/**
 * The system and framework columns of an entity table, in storage order (section 14.4.2): the
 * scope column, `id`, the timestamps, `version`, and the chain columns, which stay empty on
 * entities without a chain and after erasure.
 */
export function systemColumns(scopeColumn: string | null): readonly ColumnSpec[] {
  return [
    ...(scopeColumn === null ? [] : [column(scopeColumn, 'uuid', false)]),
    column('id', 'uuid', false),
    column('created_at', 'instant', false),
    column('updated_at', 'instant', false),
    column('archived_at', 'instant', true),
    column('version', 'integer', false, 1),
    column('kw_last_hlc', 'framework', true),
    column('kw_last_hash', 'framework', true),
    column('kw_erased_at', 'instant', true),
  ];
}
