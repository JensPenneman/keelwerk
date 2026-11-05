import type { ScopeTarget, StorageRow } from '@keelwerk/core';
import { normalizeCondition } from '@keelwerk/core';
import { namespaceOf } from './namespace-of.ts';
import type { OpenedDeployment } from './opened-deployment.ts';

/**
 * Where the chains of the given scope ids live, read from the control store: the deployment scope
 * is the control root itself, a backend is a row of `core.backend` and a tenant a row of
 * `core.tenant` (S-26), each in the shared-tables namespace of its app on its placement. An id the
 * control store does not know is left out, which `verifyAnchors` reports as unresolved.
 */
export function scopeTargetsOf(
  opened: OpenedDeployment,
): (scopeIds: ReadonlySet<string>) => Promise<ReadonlyMap<string, ScopeTarget>> {
  const registry = opened.apps[0]?.registry;
  return async (scopeIds) => {
    const targets = new Map<string, ScopeTarget>();
    if (registry === undefined) return targets;
    const backendEntity = registry.entities.get('core.backend')?.descriptor;
    const tenantEntity = registry.entities.get('core.tenant')?.descriptor;
    const handleOf = (placement: string) =>
      opened.placements.find((candidate) => candidate.name === placement);
    const row = async (
      entity: typeof backendEntity,
      id: string,
    ): Promise<StorageRow | undefined> =>
      entity === undefined
        ? undefined
        : opened.control.adapter.unit(
            opened.control.namespace,
            { level: 'deployment' },
            (unit) =>
              unit.rows.findOne(entity, {
                where: normalizeCondition({ id }),
                includeArchived: true,
              }),
            { readOnly: true },
          );
    for (const id of scopeIds) {
      if (id === opened.deploymentId) {
        targets.set(id, {
          scope: { level: 'deployment' },
          namespace: opened.control.namespace,
          handle: { adapter: opened.control.adapter },
        });
        continue;
      }
      const backend = await row(backendEntity, id);
      if (backend !== undefined) {
        const placement = handleOf(String(backend.placement));
        if (placement !== undefined) {
          targets.set(id, {
            scope: { level: 'backend', backendId: id },
            namespace: namespaceOf(placement.name, String(backend.app)),
            handle: { adapter: placement.adapter },
          });
        }
        continue;
      }
      const tenant = await row(tenantEntity, id);
      if (tenant === undefined) continue;
      const owner = await row(backendEntity, String(tenant.backendId));
      if (owner === undefined) continue;
      const placement = handleOf(
        typeof tenant.placement === 'string' ? tenant.placement : String(owner.placement),
      );
      if (placement !== undefined) {
        targets.set(id, {
          scope: { level: 'tenant', backendId: String(tenant.backendId), tenantId: id },
          namespace: namespaceOf(placement.name, String(owner.app)),
          handle: { adapter: placement.adapter },
        });
      }
    }
    return targets;
  };
}
