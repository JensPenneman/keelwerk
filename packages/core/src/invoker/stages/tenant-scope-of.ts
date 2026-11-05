import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { Scope } from '../../storage/scope.ts';
import type { BackendRecord } from '../backend-record.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ResolvedScope } from '../resolved-scope.ts';
import type { ScopeTarget } from '../scope-target.ts';
import type { TenantRecord } from '../tenant-record.ts';

function unavailable(message: string): KeelwerkError {
  return new KeelwerkError({ kind: 'unavailable', code: 'core.unavailable', message });
}

function targetOf(
  env: InvokerEnv,
  placementId: string,
  namespace: ScopeTarget['namespace'],
  scope: Scope,
): ScopeTarget {
  const handle = env.options.placement(placementId);
  if (handle === undefined) {
    throw unavailable(`Placement "${placementId}" is not connected to this process.`);
  }
  return { scope, namespace, handle };
}

/**
 * The resolved scope of a backend, or of one of its tenants (section 12.1), shared by the tenant
 * resolvers and the operator's tenant entry: `unavailable` for a suspended backend or tenant, an
 * app this process does not serve or a placement it is not connected to.
 */
export function tenantScopeOf(
  env: InvokerEnv,
  backend: BackendRecord,
  tenant: TenantRecord | null,
  resolvedBy: ResolvedScope['resolvedBy'],
): ResolvedScope {
  if (backend.status !== 'active') throw unavailable('The backend is suspended.');
  if (tenant !== null && tenant.status !== 'active') throw unavailable('The tenant is suspended.');
  env.appOf(backend.app);
  const backendScope: Scope = { level: 'backend', backendId: backend.id };
  const backendTarget = targetOf(env, backend.placementId, backend.namespace, backendScope);
  if (tenant === null) {
    return {
      scope: backendScope,
      app: backend.app,
      resolvedBy,
      target: backendTarget,
      backendTarget: null,
      ...(backend.config === undefined ? {} : { backendConfig: backend.config }),
      ...(backend.apiVersion === undefined ? {} : { pinnedVersion: backend.apiVersion }),
    };
  }
  const scope: Scope = { level: 'tenant', backendId: backend.id, tenantId: tenant.id };
  const pinned = tenant.apiVersion ?? backend.apiVersion;
  return {
    scope,
    app: backend.app,
    resolvedBy,
    target: targetOf(env, tenant.placementId, tenant.namespace, scope),
    backendTarget,
    ...(backend.config === undefined ? {} : { backendConfig: backend.config }),
    ...(pinned === undefined ? {} : { pinnedVersion: pinned }),
  };
}
