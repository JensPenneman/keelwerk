import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { Scope } from '../../storage/scope.ts';
import type { Carrier } from '../carrier.ts';
import { applyTenantResolvers } from '../edge/apply-tenant-resolvers.ts';
import { atOperatorHost } from '../edge/at-operator-host.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { JobCarrier } from '../job-carrier.ts';
import type { ResolvedScope } from '../resolved-scope.ts';
import { tenantScopeOf } from './tenant-scope-of.ts';

function gone(): KeelwerkError {
  return new KeelwerkError({
    kind: 'not_found',
    code: 'core.not_found',
    message: 'The scope of this job no longer exists.',
  });
}

/**
 * The scope a worker's carrier names (S-122): the deployment as `local`, a backend or tenant
 * through the directory; a record that is gone is `not_found`, a suspended one `unavailable`. The
 * job row is only trusted where it was found: a tenant of another backend than the one the scope
 * names, or a scope whose data is not in the namespace the job was taken from, is `not_found`.
 */
async function jobScope(env: InvokerEnv, job: JobCarrier): Promise<ResolvedScope> {
  const { scope } = job;
  const found = await jobScopeOf(env, scope);
  if (found.target === null || found.target.namespace.id !== job.namespace) throw gone();
  return found;
}

async function jobScopeOf(env: InvokerEnv, scope: Scope): Promise<ResolvedScope> {
  if (scope.level === 'deployment') {
    return {
      scope,
      app: 'core',
      resolvedBy: 'local',
      target: env.options.control ?? null,
      backendTarget: null,
    };
  }
  const { directory } = env.options;
  const backend = await directory.backend(scope.backendId);
  const tenant = scope.level === 'tenant' ? await directory.tenant(scope.tenantId) : null;
  if (
    backend === undefined ||
    tenant === undefined ||
    (tenant && tenant.backendId !== scope.backendId)
  ) {
    throw gone();
  }
  return tenantScopeOf(env, backend, tenant, 'local');
}

/**
 * `resolveScope` (section 9.2): a worker's carrier names its job's scope; the operator's local carrier, and a carrier with an operator token at an operator host name (section 3.5), are the deployment scope; every other
 * carrier goes through the deployment's tenant resolvers in order. Fails closed with `not_found`
 * for an unknown host, header value or tenant, and `unavailable` for a suspended backend or tenant,
 * an app this process does not serve or a placement it is not connected to.
 */
export async function resolveScope(env: InvokerEnv, carrier: Carrier): Promise<ResolvedScope> {
  if (carrier.job !== undefined) return jobScope(env, carrier.job);
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
