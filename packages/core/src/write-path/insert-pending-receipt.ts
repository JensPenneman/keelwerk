import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Receipt } from '../storage/receipt.ts';
import type { Unit } from '../storage/unit.ts';

/** What the first statement of a command's unit found. */
export type PendingReceipt =
  | { readonly kind: 'inserted' }
  /** A finished command of the same id and fingerprint: answer its outcome. */
  | { readonly kind: 'replay'; readonly receipt: Receipt };

/**
 * Inserts the receipt as `pending` and holds its row until commit (section 15.1.7). An existing
 * receipt with another fingerprint or another principal is `core.idempotency_mismatch` (a command
 * id is a key one principal chose, so another principal never reads its outcome); one that is still pending or
 * accepted is `core.command_in_progress` (retryable), because its decision may be running; a
 * finished one is a replay.
 */
export async function insertPendingReceipt(unit: Unit, receipt: Receipt): Promise<PendingReceipt> {
  if ((await unit.receipts.claim(receipt)) === 'inserted') {
    return { kind: 'inserted' };
  }
  const existing = await unit.receipts.get(receipt.commandId);
  if (existing === undefined) {
    throw errors.internal(`the receipt of command ${receipt.commandId} vanished`);
  }
  if (
    existing.principal?.resolver !== receipt.principal?.resolver ||
    existing.principal?.principalId !== receipt.principal?.principalId ||
    existing.fingerprint !== receipt.fingerprint
  ) {
    throw new KeelwerkError({
      kind: 'conflict',
      code: 'core.idempotency_mismatch',
      message: 'The command id was used with a different request.',
    });
  }
  if (existing.status === 'pending' || existing.status === 'accepted') {
    throw new KeelwerkError({
      kind: 'conflict',
      code: 'core.command_in_progress',
      message: 'A command with this id is still running.',
      retryable: true,
    });
  }
  return { kind: 'replay', receipt: existing };
}
