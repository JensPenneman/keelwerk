/**
 * The steps of section 14.7.5 a record passes, in order; `afterStep` of the worker names the one
 * that just committed. `reach` is the request for the erasure of the pending rows that name the
 * subject's addresses (`reachErasure`), the last step before the keys are destroyed. `tombstones`
 * is the end of step 2 (the destroyed keys are in the control ledger and every sink) and
 * `completed` follows the receipt, with the completion record in the control ledger.
 */
export type ErasureStep =
  | 'ledger'
  | 'reach'
  | 'shred'
  | 'tombstones'
  | 'streams'
  | 'principals'
  | 'flags'
  | 'receipt'
  | 'completed';
