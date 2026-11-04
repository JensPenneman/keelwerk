import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { Scope } from '../../storage/scope.ts';
import type { Carrier } from '../carrier.ts';
import { applyTenantResolvers } from '../edge/apply-tenant-resolvers.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ResolvedScope } from '../resolved-scope.ts';
import type { ScopeTarget } from '../scope-target.ts';

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
 * `resolveScope` (section 9.2): the operator's local carrier is the deployment scope; every other
 * carrier goes through the deployment's tenant resolvers in order. Fails closed with `not_found`
 * for an unknown host, header value or tenant, and `unavailable` for a suspended backend or tenant,
 * an app this process does not serve or a placement it is not connected to.
 */
export async function resolveScope(env: InvokerEnv, carrier: Carrier): Promise<ResolvedScope> {
  if (carrier.local !== undefined) {
    return {
      scope: { level: 'deployment' },
      app: 'core',
      resolvedBy: 'local',
      target: env.options.control ?? null,
      backendTarget: null,
    };
  }
  const found = await applyTenantResolvers(env.tenantResolution, carrier, env.options.directory);
  if (found === undefined) {
    throw new KeelwerkError({
      kind: 'not_found',
      code: 'core.not_found',
      message: 'No backend or tenant answers this request.',
    });
  }
  const { backend, tenant, resolvedBy } = found;
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
    ...(pinned === undefined ? {} : { pinnedVersion: pinned }),
  };
}
