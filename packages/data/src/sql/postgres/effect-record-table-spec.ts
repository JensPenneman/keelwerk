import type { EntityDescriptor, TableSpec } from '@keelwerk/core';
import { invocationTableSpec } from './invocation-table-spec.ts';

/**
 * The table of the `core.effect` entity (7.9.6), indexed on the scope, the type and the status for
 * the scan of the effects an outside performer still has to settle.
 */
export function effectRecordTableSpec(entity: EntityDescriptor): TableSpec {
  return invocationTableSpec(entity, [
    {
      name: `${entity.table}_pending`,
      columns: ['scope_id', 'type', 'status'],
      unique: false,
      method: 'btree',
      where: null,
    },
  ]);
}
