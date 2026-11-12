import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { sealPersonalMembers } from './seal-personal-members.ts';
import { sealSecretMembers } from './seal-secret-members.ts';

/**
 * The input a command job stores (architecture 7.4, 14.7.4, S-127): every `field.secret()` member
 * of the action's input is sealed under a value key bound to `core.job`, the command id and the
 * member (`sealSecretMembers` with `refs: 'keep'`), so the job row, a dead letter and the history
 * hold no plaintext secret. The worker opens them again with `openSecretMembers` before it invokes the
 * action. The fingerprint of the command stays over the plaintext input.
 * Personal members are sealed under the data key of the subject they name (`sealPersonalMembers`),
 * so the subject's erasure reaches them whoever started the job.
 * The binding is the command id and the member path; the stored form is final (golden vector in `seal-job-input.test.ts`).
 */
export async function sealJobInput(
  unit: Unit,
  registry: Registry,
  commandId: string,
  action: ActionEntry,
  input: unknown,
): Promise<unknown> {
  const secretsSealed = await sealSecretMembers(
    unit,
    { entity: 'core.job', id: commandId, prefix: '', refs: 'keep' },
    action.input,
    input,
  );
  return sealPersonalMembers({ unit, registry, action, commandId, input: secretsSealed });
}
