import type { ActionEntry } from '../registry/action-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { sealSecretMembers } from './seal-secret-members.ts';

/**
 * The input a command job stores (architecture 7.4, 14.7.4, S-127): every `field.secret()` member
 * of the action's input is sealed under a value key bound to `core.job`, the command id and the
 * member (`sealSecretMembers` with `refs: 'keep'`), so the job row, a dead letter and the history
 * hold no plaintext secret. The worker opens them again with `openSecretMembers` before it invokes the
 * action. The fingerprint of the command stays over the plaintext input.
 * The binding is the command id and the member path; the stored form is final (golden vector in `seal-job-input.test.ts`).
 */
export function sealJobInput(
  unit: Unit,
  commandId: string,
  action: ActionEntry,
  input: unknown,
): Promise<unknown> {
  return sealSecretMembers(
    unit,
    { entity: 'core.job', id: commandId, prefix: '', refs: 'keep' },
    action.input,
    input,
  );
}
