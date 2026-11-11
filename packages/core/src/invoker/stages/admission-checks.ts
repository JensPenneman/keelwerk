import type { AdmissionRun } from '../../admission/run-admission.ts';
import { checkKillSwitches } from '../../flags/check-kill-switches.ts';
import type { InvokerEnv } from '../invoker-env.ts';

/**
 * The M2 checks at `admit`, in order, before the admission rules; a check refuses by throwing a
 * `KeelwerkError` (fail closed) and sees `run.dry`.
 */
export const admissionChecks: readonly ((env: InvokerEnv, run: AdmissionRun) => Promise<void>)[] = [
  checkKillSwitches,
];
