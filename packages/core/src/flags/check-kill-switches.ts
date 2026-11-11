import type { AdmissionRun } from '../admission/run-admission.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import { closedGateRefusal } from './closed-gate-refusal.ts';

/**
 * The admission check of 20.6: a closed gate of a kill-switch flag refuses before the admission
 * rules with `unavailable` `core.feature_suspended`.
 */
export function checkKillSwitches(env: InvokerEnv, run: AdmissionRun): Promise<void> {
  const { registry } = env.appOf(run.details.resolved.app);
  const refusal = closedGateRefusal(registry, run.action, run.flags, 'admit');
  return refusal === undefined ? Promise.resolve() : Promise.reject(refusal);
}
