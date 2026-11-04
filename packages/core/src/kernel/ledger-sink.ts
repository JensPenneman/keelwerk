import type { LedgerRecord } from './ledger-record.ts';

/** An append-only log outside the placement and its backups (section 14.7.6). */
export interface LedgerSink {
  readonly id: string;
  /** Appends the batch and syncs it to durable storage once; resolves when it is safe. */
  append(records: readonly LedgerRecord[]): Promise<void>;
  /** Every record of a type this release knows, in append order. */
  read(): AsyncIterable<LedgerRecord>;
}
