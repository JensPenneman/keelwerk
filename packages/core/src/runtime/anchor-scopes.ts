import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Connected } from './connected.ts';
import type { Migrated } from './migrate-phase.ts';

/** The unit targets that read the heads of the wanted scope ids (the deployment, a backend or a tenant); an id that resolves to nothing is left out. */
export async function anchorScopes(
  connected: Connected,
  migrated: Migrated,
  wanted: ReadonlySet<string>,
): Promise<ReadonlyMap<string, ScopeTarget>> {
  const scopes = new Map<string, ScopeTarget>();
  const { control } = connected;
  const { lookup } = migrated.directory;
  for (const id of wanted) {
    if (id === connected.deploymentId) {
      scopes.set(id, {
        scope: { level: 'deployment' },
        namespace: control.namespace,
        handle: { adapter: control.adapter, capabilities: control.capabilities },
      });
      continue;
    }
    const backend = await lookup.backend(id).catch(() => undefined);
    const backendHandle =
      backend === undefined ? undefined : connected.placements.get(backend.placementId);
    if (backend !== undefined && backendHandle !== undefined) {
      scopes.set(id, {
        scope: { level: 'backend', backendId: backend.id },
        namespace: backend.namespace,
        handle: backendHandle,
      });
      continue;
    }
    const tenant = await lookup.tenant(id).catch(() => undefined);
    const tenantHandle =
      tenant === undefined ? undefined : connected.placements.get(tenant.placementId);
    if (tenant !== undefined && tenantHandle !== undefined) {
      scopes.set(id, {
        scope: { level: 'tenant', backendId: tenant.backendId, tenantId: tenant.id },
        namespace: tenant.namespace,
        handle: tenantHandle,
      });
    }
  }
  return scopes;
}
