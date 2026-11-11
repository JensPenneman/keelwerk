import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Receipt } from '../storage/receipt.ts';
import type { Unit } from '../storage/unit.ts';
import { assertSameRequest } from './assert-same-request.ts';

/** What the first statement of a command's unit found. */
export type PendingReceipt =
  | { readonly kind: 'inserted' }
  /** A finished command of the same id and fingerprint: answer its outcome. */
  | { readonly kind: 'replay'; readonly receipt: Receipt }
  /** An `accepted` receipt of the same request that a worker took over to run the command of its job: it is not replayed. */
  | { readonly kind: 'taken' };

/**
 * Inserts the receipt as `pending` and holds its row until commit (section 15.1.7). An existing
 * receipt with another fingerprint or another principal is `core.idempotency_mismatch` (a command
 * id is a key one principal chose, so another principal never reads its outcome); one that is still pending or
 * accepted is `core.command_in_progress` (retryable), because its decision may be running; a
 * finished one is a replay. With `takeOver` (a worker running the command of its job) an `accepted`
 * receipt is taken, but only when it is the same request: the same principal reference and the same
 * input fingerprint, because a job's command id is not always the receipt's own (an `enqueue` effect
 * may name any id) and another principal's accepted receipt must never be completed by it. The
 * legitimate job reproduces both: the principal re-resolved from the stored reference has that
 * reference, and the stored input is the one that was fingerprinted.
 */
export async function insertPendingReceipt(
  unit: Unit,
  receipt: Receipt,
  options: { readonly takeOver?: boolean } = {},
): Promise<PendingReceipt> {
  if ((await unit.receipts.claim(receipt)) === 'inserted') {
    return { kind: 'inserted' };
  }
  const existing = await unit.receipts.get(receipt.commandId);
  if (existing === undefined) {
    throw errors.internal(`the receipt of command ${receipt.commandId} vanished`);
  }
  assertSameRequest(existing, receipt);
  if (options.takeOver === true && existing.status === 'accepted') return { kind: 'taken' };
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
