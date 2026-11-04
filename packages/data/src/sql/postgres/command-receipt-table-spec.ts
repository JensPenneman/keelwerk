import type { EntityDescriptor, TableSpec } from '@keelwerk/core';
import { fieldColumns } from '../../migrations/field-columns.ts';
import { systemColumns } from '../../migrations/system-columns.ts';

/** The system columns a receipt row keeps: the scope, the id, the version and the two timestamps. */
const kept = new Set(['scope_id', 'id', 'created_at', 'updated_at', 'version']);

/**
 * The table of the `core.commandReceipt` entity (15.1.7): the fields of the descriptor behind the
 * system columns, keyed on `scope_id` (one namespace holds the receipts of a tenant, a backend
 * and the deployment), unique on the scope and the command id, and indexed for the sync reads
 * of one client's receipts.
 */
export function commandReceiptTableSpec(entity: EntityDescriptor): TableSpec {
  return {
    name: entity.table,
    columns: [
      ...systemColumns('scope_id').filter((column) => kept.has(column.name)),
      ...Object.entries(entity.fields).flatMap(([name, field]) =>
        fieldColumns(name, field, [], false),
      ),
    ],
    primaryKey: ['scope_id', 'id'],
    indexes: [
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
    ],
    foreignKeys: [],
    scoped: 'tenant',
  };
}
