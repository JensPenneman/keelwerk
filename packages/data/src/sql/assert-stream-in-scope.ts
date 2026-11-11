import type { EntityDescriptor, StorageScope } from '@keelwerk/core';
import { scopeForbidden } from './scope-forbidden.ts';

/**
 * Refuses an append to the stream of an entity that does not ride with the unit's scope (14.3.6,
 * 15.1.11): a tenant entity's events go through a tenant unit, a backend entity's through a backend
 * unit, a deployment entity's through a deployment unit, and an invocation-scoped entity's through
 * a tenant or backend unit, wherever the command ran. A stream the kernel appends without an entity
 * (a process's state stream) names its tenancy and is checked the same way.
 */
export function assertStreamInScope(
  entity: Pick<EntityDescriptor, 'ref' | 'tenancy'>,
  scope: StorageScope,
): void {
  const allowed =
    entity.tenancy === 'invocation'
      ? scope.level === 'tenant' || scope.level === 'backend'
      : entity.tenancy === scope.level;
  if (!allowed) {
    throw scopeForbidden(
      `a ${scope.level}-scope unit cannot append to the stream of the ${entity.tenancy} entity ${entity.ref}`,
      { entity: entity.ref, scope: scope.level },
    );
  }
}
