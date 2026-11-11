import type { EntityDescriptor, TableSpec } from '@keelwerk/core';
import { fieldColumns } from '../../migrations/field-columns.ts';
import { systemColumns } from '../../migrations/system-columns.ts';

/** The system columns a row of an invocation entity keeps: the scope, the id, the version and the two timestamps (decision 398: no kw_* columns). */
const kept = new Set(['scope_id', 'id', 'created_at', 'updated_at', 'version']);

/**
 * The table of an entity of invocation tenancy (receipts, effect records): the fields of the
 * descriptor behind the kept system columns, keyed on `scope_id` and the id (one namespace holds
 * the rows of a tenant, a backend and the deployment), with the indexes the entity names and no
 * foreign keys.
 */
export function invocationTableSpec(
  entity: EntityDescriptor,
  indexes: TableSpec['indexes'],
): TableSpec {
  return {
    name: entity.table,
    columns: [
      ...systemColumns('scope_id').filter((column) => kept.has(column.name)),
      ...Object.entries(entity.fields).flatMap(([name, field]) =>
        fieldColumns(name, field, [], false),
      ),
    ],
    primaryKey: ['scope_id', 'id'],
    indexes,
    foreignKeys: [],
    scoped: 'tenant',
  };
}
