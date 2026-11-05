import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { Carrier } from '../carrier.ts';
import { applyTenantResolvers } from '../edge/apply-tenant-resolvers.ts';
import { atOperatorHost } from '../edge/at-operator-host.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ResolvedScope } from '../resolved-scope.ts';
import { tenantScopeOf } from './tenant-scope-of.ts';

/**
 * `resolveScope` (section 9.2): the operator's local carrier, and a carrier with an operator token at an operator host name (section 3.5), are the deployment scope; every other
 * carrier goes through the deployment's tenant resolvers in order. Fails closed with `not_found`
 * for an unknown host, header value or tenant, and `unavailable` for a suspended backend or tenant,
 * an app this process does not serve or a placement it is not connected to.
 */
export async function resolveScope(env: InvokerEnv, carrier: Carrier): Promise<ResolvedScope> {
  if (carrier.local !== undefined || atOperatorHost(env, carrier)) {
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
  return tenantScopeOf(env, found.backend, found.tenant, found.resolvedBy);
}
