import type { AdmissionRun } from '../admission/run-admission.ts';
import { errors } from '../errors/errors.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';

/**
 * The slot an admitted invocation holds under the deployment-wide counts (12.2, 15.4.10): a
 * subscription one of `core.liveSubscriptions`, any other action one of `core.concurrentInvocations`,
 * of the tenant, or of the backend for an action of backend scope. Taken after the admission checks
 * and before the rules; answers its release, which the caller gives back once when the invocation
 * ends. No slot, as for the request rate: without quotas or leases, for a job, a request without a
 * target or in the deployment scope, and for a dry run, which holds nothing. Past the limit:
 * `rate_limited` `core.concurrency_limited`.
 */
export async function takeAdmissionSlot(
  env: InvokerEnv,
  run: AdmissionRun,
): Promise<(() => void) | undefined> {
  const { leases, quotas } = env.options;
  const { resolved, carrier } = run.details;
  if (leases === undefined || quotas === undefined || carrier.job !== undefined) return undefined;
  if (run.dry === true || resolved.target === null) return undefined;
  const { scope } =
    run.action.scope === 'backend' && resolved.backendTarget !== null
      ? resolved.backendTarget
      : resolved.target;
  if (scope.level === 'deployment') return undefined;
  const subscription = run.action.kind === 'subscription';
  const dimension = subscription ? 'core.liveSubscriptions' : 'core.concurrentInvocations';
  const limit = (await quotas.fresh()).limitOf(env.appOf(resolved.app).registry, scope, dimension);
  if (limit.kind !== 'count') throw errors.internal(`The quota "${dimension}" is not a count.`);
  return leases.take({
    kind: subscription ? 'subscriptions' : 'invocations',
    scopeId: scope.level === 'tenant' ? scope.tenantId : scope.backendId,
    dimension,
    limit: limit.value,
  });
}
