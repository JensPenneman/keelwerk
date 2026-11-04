import type { EntityDescriptor, StorageRow } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * Throws `conflict` `core.reference_missing` when a hard reference (`ref.foreignKey`) of the row
 * points at a target row the unit does not see, the way the composite foreign key of the SQL
 * adapters does (14.4.3). The target is looked up in the unit's own view, so a row written
 * earlier in the unit counts; `staged` holds the rows of the same call that are not written yet.
 * A target outside the unit's scope cannot be a foreign key target, so it is missing.
 */
export function memoryCheckReferences(
  ctx: MemoryUnitContext,
  entity: EntityDescriptor,
  row: StorageRow,
  staged: ReadonlyMap<string, StorageRow>,
): void {
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.ref === null || !field.ref.foreignKey) continue;
    const value = row[name];
    if (typeof value !== 'string') continue;
    const target = ctx.entity(field.ref.entity);
    const reachable =
      target !== undefined &&
      (target.tenancy === 'invocation' || target.tenancy === entity.tenancy);
    const found =
      reachable &&
      (ctx.rows(target).has(value) || (target.ref === entity.ref && staged.has(value)));
    if (!found) {
      throw new KeelwerkError({
        kind: 'conflict',
        code: 'core.reference_missing',
        message: `${entity.ref}.${name} refers to a ${field.ref.entity} row that does not exist`,
        details: { entity: entity.ref, field: name, target: field.ref.entity },
      });
    }
  }
}
