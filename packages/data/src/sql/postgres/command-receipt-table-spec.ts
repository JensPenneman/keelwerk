import type { EntityDescriptor, TableSpec } from '@keelwerk/core';
import { invocationTableSpec } from './invocation-table-spec.ts';

/**
 * The table of the `core.commandReceipt` entity (15.1.7): unique on the scope and the command id,
 * and indexed for the sync reads of one client's receipts.
 */
export function commandReceiptTableSpec(entity: EntityDescriptor): TableSpec {
  return invocationTableSpec(entity, [
    {
      name: `${entity.table}_command`,
      columns: ['scope_id', 'command_id'],
      unique: true,
      method: 'btree',
      where: null,
    },
    {
      name: `${entity.table}_client`,
      columns: ['scope_id', 'client_id', 'client_seq'],
      unique: false,
      method: 'btree',
      where: null,
    },
  ]);
}
