import { errors } from '../errors/errors.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import type { Unit } from '../storage/unit.ts';
import { replayKeyDestroyed } from './replay-key-destroyed.ts';

/**
 * A value a decision record sealed under a key of its own, opened against the binding of its own
 * command: `core.decision`, the command id and the field. A gone key is
 * `replayKeyDestroyed(what)`; a value that opens for no binding but another (a record copied,
 * restored or moved from another command) is `internal`, naming the record, never handed on.
 */
export async function openRecordedSealed(
  unit: Unit,
  sealed: SealedValue,
  binding: { readonly commandId: string; readonly field: 'input' | 'request' },
  what: string,
): Promise<Uint8Array> {
  const expected = { entity: 'core.decision', id: binding.commandId, field: binding.field };
  const opened = await unit.keys.openValue(sealed, expected);
  if (opened !== undefined) return opened;
  if ((await unit.keys.openValue(sealed)) === undefined) throw replayKeyDestroyed(what);
  throw errors.internal(`${what} does not belong to command ${binding.commandId}.`);
}
