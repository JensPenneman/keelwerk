import type { ColumnSpec } from '@keelwerk/core';

export const column = (
  name: string,
  field: string | null,
  over: Partial<ColumnSpec> = {},
): ColumnSpec => ({
  name,
  field,
  kind: 'string',
  nullable: true,
  default: null,
  constraints: {},
  ...over,
});
