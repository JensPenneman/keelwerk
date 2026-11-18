import type { ErasureRecord } from '../ledger/erasure-record.ts';

/** An erasure record with no completion at its tenant's epoch (`ControlLedger.unfinished`). */
export interface UnfinishedErasure {
  readonly seq: bigint;
  readonly record: ErasureRecord;
  /** A completion of this erasure stands after it at another epoch: a restore made it run again. */
  readonly rerun: boolean;
}
