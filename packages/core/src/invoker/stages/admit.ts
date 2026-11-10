import type { AdmissionRun, Admitted } from '../../admission/run-admission.ts';
import { runAdmission } from '../../admission/run-admission.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import { admissionChecks } from './admission-checks.ts';

/**
 * `admit` (section 9.2): the admission rules of `invocationMiddleware` run as pure values and the
 * kernel takes the buckets they name (section 12.2). A refusal is thrown and fails closed; what the
 * rules want charged on a declared failure is returned for `complete`. Nothing here wraps or skips a
 * later stage.
 */
export async function admit(env: InvokerEnv, run: AdmissionRun): Promise<Admitted> {
  for (const check of admissionChecks) await check(env, run);
  return runAdmission(env, run);
}
