import type { Receipt } from './receipt.ts';
import type { ReceiptOutcome } from './receipt-outcome.ts';

/** Receipts of a unit's scope (section 15.1.7). */
export interface ReceiptStore {
  get(commandId: string): Promise<Receipt | undefined>;
  /** Inserts the receipt; `conflict` when the id exists with another fingerprint. */
  put(receipt: Receipt): Promise<void>;
  /**
   * Inserts the receipt as the first statement of a command's unit and holds its row until commit
   * (section 15.1.7): `inserted` when this unit now owns the command id, `exists` when a receipt
   * of that id was already there (the caller reads it and decides between replay, mismatch and
   * in-progress). It never changes an existing receipt.
   */
  claim(receipt: Receipt): Promise<'inserted' | 'exists'>;
  complete(commandId: string, outcome: ReceiptOutcome): Promise<void>;
  /** Sync: outcomes of one client's mutations after a client sequence number (M6). */
  forClient(clientId: string, afterSeq: number, limit: number): Promise<readonly Receipt[]>;
  acknowledge(clientId: string, uptoSeq: number): Promise<void>;
}
