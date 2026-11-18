import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { generatedJobRefusal } from './generated-job-refusal.ts';
import { sealPersonalMembers } from './seal-personal-members.ts';
import { sealSecretMembers } from './seal-secret-members.ts';

/**
 * The input a command job stores (architecture 7.4, 14.7.4, S-127): every `field.secret()` member
 * of the action's input is sealed under a value key bound to `core.job`, the command id and the
 * member (`sealSecretMembers` with `refs: 'keep'`), so the job row, a dead letter and the history
 * hold no plaintext secret. The worker opens them again with `openSecretMembers` before it invokes
 * the action. The fingerprint of the command is computed from the opened input. Personal members
 * are sealed under the data key of the subject they name (`sealPersonalMembers`), so the subject's
 * erasure reaches them whoever started the job. A generated write whose row would hold a credential
 * or personal value unsealed is refused first (`generatedJobRefusal`). The binding is the command
 * id and the member path; the stored form is final (golden vector in `seal-job-input.test.ts`).
 */
export async function sealJobInput(
  unit: Unit,
  registry: Registry,
  commandId: string,
  action: ActionEntry,
  input: unknown,
): Promise<unknown> {
  // Before any sealing, so nothing is sealed or enqueued for a job that would hold a value in
  // clear.
  const refused = generatedJobRefusal(registry, action, input);
  if (refused !== undefined) throw refused;
  const secretsSealed = await sealSecretMembers(
    unit,
    { entity: 'core.job', id: commandId, prefix: '', refs: 'keep' },
    action.input,
    input,
  );
  return sealPersonalMembers({ unit, registry, action, commandId, input: secretsSealed });
}
