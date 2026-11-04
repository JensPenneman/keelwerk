import type { ColumnSpec } from '@keelwerk/core';

/** A neutral column of the migration cases. */
export function migrationColumn(name: string, over: Partial<ColumnSpec> = {}): ColumnSpec {
  return {
    name,
    field: name === 'id' ? null : name,
    kind: 'string',
    nullable: true,
    default: null,
    constraints: {},
    ...over,
  };
}
