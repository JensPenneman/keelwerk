import type { AdmissionRun, Admitted } from '../../admission/run-admission.ts';
import { runAdmission } from '../../admission/run-admission.ts';
import { takeAdmissionSlot } from '../../quotas/admission-slot.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import { admissionChecks } from './admission-checks.ts';

/**
 * `admit` (section 9.2): the admission rules of `invocationMiddleware` run as pure values and the
 * kernel takes the buckets they name (section 12.2), after the invocation's slot of the
 * deployment-wide counts (`takeAdmissionSlot`), which a refusal by the rules gives back. A refusal
 * is thrown and fails closed; what the rules want charged on a declared failure is returned for
 * `complete`. Nothing here wraps or skips a later stage.
 */
export async function admit(env: InvokerEnv, run: AdmissionRun): Promise<Admitted> {
  for (const check of admissionChecks) await check(env, run);
  const release = await takeAdmissionSlot(env, run);
  try {
    const admitted = await runAdmission(env, run);
    return release === undefined ? admitted : { ...admitted, release };
  } catch (error) {
    release?.();
    throw error;
  }
}
