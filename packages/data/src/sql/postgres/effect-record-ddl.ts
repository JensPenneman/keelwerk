import type { EntityDescriptor } from '@keelwerk/core';
import { coreEntityDescriptor } from './core-entity-descriptor.ts';
import { effectRecordTableSpec } from './effect-record-table-spec.ts';
import { invocationTableDdl } from './invocation-table-ddl.ts';

/**
 * The effect table as the row store reads and writes it, provisioned from the descriptor of
 * `core.effect`: one row per effect, keyed on the scope the effect was requested in (`scope_id`
 * holds the tenant, backend or deployment id, as in the other framework tables) and the effect id.
 * A unit sees and writes the rows of its own scope; a maintenance unit of the namespace may read
 * and delete them (the dump, retention and the removal of a scope) but not insert or update: effect
 * rows change only through the write path, in the unit of their scope.
 */
export function effectRecordDdl(
  root: string,
  entity: EntityDescriptor = coreEntityDescriptor('core.effect'),
): readonly string[] {
  return invocationTableDdl(root, effectRecordTableSpec(entity), 'select-delete');
}
