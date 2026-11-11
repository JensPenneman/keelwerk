import type { TableSpec } from '@keelwerk/core';

/** Whether a table is an invocation table: its primary key leads with `scope_id` (the scope of one namespace's rows, 14.4.2). */
export function isInvocationTable(table: Pick<TableSpec, 'primaryKey'>): boolean {
  return table.primaryKey[0] === 'scope_id';
}
