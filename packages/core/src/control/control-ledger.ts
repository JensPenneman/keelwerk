import type { LedgerRecord } from '../kernel/ledger-record.ts';

/**
 * kw__control.kw_ledger (section 14.7.5, S-125): append only, the sinks' canonical records; the
 * kernel appends `erasure` and `keyTombstone` here, anchors stay in the sinks. Joins `ControlStore`
 * as `ledger` in WP-100.
 */
export interface ControlLedger {
  /** Answers the record's seq. */
  append(record: LedgerRecord): Promise<bigint>;
  /** After seq, in seq order. */
  since(
    seq: bigint,
    limit: number,
  ): Promise<readonly { readonly seq: bigint; readonly record: LedgerRecord }[]>;
}
