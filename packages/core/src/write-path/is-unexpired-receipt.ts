import type { Receipt } from '../storage/receipt.ts';

/** Whether the receipt still counts at `now`: one whose `expiresAt` is not after `now` is replaced by a claim, so it counts as absent. */
export function isUnexpiredReceipt(
  receipt: Pick<Receipt, 'expiresAt'>,
  now: Temporal.Instant,
): boolean {
  return Temporal.Instant.compare(receipt.expiresAt, now) > 0;
}
