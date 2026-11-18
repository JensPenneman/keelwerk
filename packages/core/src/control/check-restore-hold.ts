import type { AdmissionRun } from '../admission/run-admission.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';

/**
 * The admission check of 14.7.6: a run in a tenant scope whose tenant is held by `restoreHold`
 * (an erasure a restore made run again) is refused with `core.unavailable` until the hold lifts;
 * a run in any other scope, or an invoker without a hold, passes.
 */
export async function checkRestoreHold(env: InvokerEnv, run: AdmissionRun): Promise<void> {
  const scope = run.details.resolved.target?.scope;
  if (scope?.level !== 'tenant') return;
  await env.options.restoreHold?.check(scope.tenantId);
}
