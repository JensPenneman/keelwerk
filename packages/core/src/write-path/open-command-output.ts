import type { ActionEntry } from '../registry/action-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { openSecretMembers } from './open-secret-members.ts';

/**
 * A receipt's stored value for a replay to its submitter (15.1.7, S-127; `assertSameRequest` keeps
 * other principals out): each `kwv1` string in a secret member is opened with `unit.keys.openValue`
 * against the binding the receipt sealed it under (`core.commandReceipt`, `commandId`,
 * `outcome.<member>`) and answered as plaintext; `{ ref }` members and texts that are no `kwv1` pass unchanged.
 * Throws `conflict` "The stored output can no longer be read; send the command again with a new
 * command id." when a key is gone or was sealed for another command or effect (a text a command
 * of an earlier version stored as plaintext).
 */
export function openCommandOutput(
  unit: Unit,
  commandId: string,
  action: ActionEntry,
  value: unknown,
): Promise<unknown> {
  return openSecretMembers(
    unit,
    {
      entity: 'core.commandReceipt',
      id: commandId,
      prefix: 'outcome.',
      lost: 'The stored output can no longer be read; send the command again with a new command id.',
    },
    action.output,
    value,
  );
}
