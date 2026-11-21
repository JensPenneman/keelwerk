import type { Receipt } from '../storage/receipt.ts';
import type { Unit } from '../storage/unit.ts';
import { assertSameRequest } from './assert-same-request.ts';
import { isUnexpiredReceipt } from './is-unexpired-receipt.ts';
import type { PerformInlineInput } from './perform-inline.ts';
import { receiptRow } from './receipt-row.ts';
import { receiptWindowMs } from './receipt-window-ms.ts';

/**
 * The unexpired receipt of the command id of an inline `perform`, read inside the begin unit (one
 * plain read, no lock), after `assertSameRequest` has held it to this request's principal and
 * fingerprint: another request is `core.idempotency_mismatch`, the refusal phase 3 would give,
 * only before any effect. An expired receipt counts as absent, as `claim` treats one (a receipt
 * whose `expiresAt` is not after `now` is replaced); so does a receipt that is not committed yet,
 * which a plain read does not see. Undefined when there is none.
 */
export async function readInlineReceipt(
  unit: Unit,
  input: PerformInlineInput,
  now: Temporal.Instant,
): Promise<Receipt | undefined> {
  const { run, commandId } = input;
  const receipt = await unit.receipts.get(commandId);
  if (receipt === undefined || !isUnexpiredReceipt(receipt, now)) return undefined;
  assertSameRequest(
    receipt,
    receiptRow({
      commandId,
      action: run.action.ref,
      fingerprint: input.fingerprint,
      principal: run.principal,
      apiVersion: run.apiVersion,
      request: run.request,
      now,
      windowMs: receiptWindowMs(run.action, run.job),
    }),
    input.legacyFingerprint,
  );
  return receipt;
}
