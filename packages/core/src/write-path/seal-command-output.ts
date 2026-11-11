import { sealSecretMembers } from '../effects/seal-secret-members.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Unit } from '../storage/unit.ts';
import type { CommandOutput } from './command-output.ts';

/**
 * The outcome a receipt keeps (15.1.7, S-127): for a `value` outcome whose action output declares a
 * secret member, `sealSecretMembers(unit, { entity: 'core.commandReceipt', id: commandId,
 * prefix: 'outcome.', refs: 'keep' }, action.output, outcome.value)`; any other outcome is answered
 * as the same object.
 */
export async function sealCommandOutput(
  unit: Unit,
  commandId: string,
  action: ActionEntry,
  outcome: CommandOutput['outcome'],
): Promise<CommandOutput['outcome']> {
  if (!('value' in outcome)) return outcome;
  const sealed = await sealSecretMembers(
    unit,
    { entity: 'core.commandReceipt', id: commandId, prefix: 'outcome.', refs: 'keep' },
    action.output,
    outcome.value,
  );
  return sealed === outcome.value ? outcome : { ...outcome, value: sealed };
}
