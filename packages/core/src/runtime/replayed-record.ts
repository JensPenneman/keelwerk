import type { LedgerRecord } from '../kernel/ledger-record.ts';

/** The records the ledger replay reconciles between the sinks and the control ledger: erasures and key tombstones. */
export type ReplayedRecord = Extract<LedgerRecord, { readonly type: 'erasure' | 'keyTombstone' }>;
