import type { ActionEntry } from '../registry/action-entry.ts';
import { defaultReceiptWindowMs } from './default-receipt-window-ms.ts';

/**
 * When a receipt that finishes at `now` may expire at the earliest: the action's idempotency
 * window, or the default one for an action this build does not know, counted from `now`. A
 * receipt's store keeps the later of this and its own expiry (`ReceiptStore.complete`).
 */
export function receiptExpiryAfter(
  action: Pick<ActionEntry, 'idempotencyWindowMs'> | undefined,
  now: Temporal.Instant,
): Temporal.Instant {
  return now.add({ milliseconds: action?.idempotencyWindowMs ?? defaultReceiptWindowMs });
}
