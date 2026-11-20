import type { Receipt } from '../storage/receipt.ts';

/** Whether the receipt holds the outcome of its command (`completed` or `failed`); a pending or accepted one does not. */
export function isFinishedReceipt(receipt: Pick<Receipt, 'status'>): boolean {
  return receipt.status === 'completed' || receipt.status === 'failed';
}
