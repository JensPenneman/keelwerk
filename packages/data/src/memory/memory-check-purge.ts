import type { EntityDescriptor } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * Throws `conflict` `core.reference_missing` when a row about to be purged is the target of a
 * hard reference (`ref.foreignKey`) of a row that stays, the way the foreign key of the SQL
 * adapters refuses the delete (NO ACTION, 23503, 14.4.3). Rows purged in the same call do not
 * count: the statement checks the keys at its end.
 */
export function memoryCheckPurge(
  ctx: MemoryUnitContext,
  entity: EntityDescriptor,
  ids: ReadonlySet<string>,
): void {
  for (const referrer of ctx.state.entities.values()) {
    if (referrer.tenancy !== 'invocation' && referrer.tenancy !== entity.tenancy) continue;
    for (const [name, field] of Object.entries(referrer.fields)) {
      if (field.ref === null || !field.ref.foreignKey || field.ref.entity !== entity.ref) continue;
      for (const row of ctx.rows(referrer).values()) {
        const value = row[name];
        if (typeof value !== 'string' || !ids.has(value)) continue;
        if (referrer.ref === entity.ref && ids.has(String(row.id))) continue;
        throw new KeelwerkError({
          kind: 'conflict',
          code: 'core.reference_missing',
          message: `${entity.ref} row ${value} is still referred to by ${referrer.ref}.${name}`,
          details: { entity: entity.ref, id: value, referrer: referrer.ref, field: name },
        });
      }
    }
  }
}
