import type { LedgerRecord } from '../kernel/ledger-record.ts';
import type { LedgerLookup } from './ledger-lookup.ts';
import type { UnfinishedErasure } from './unfinished-erasure.ts';

/**
 * kw__control.kw_ledger (section 14.7.5, S-125): append only, the sinks' canonical records; the
 * kernel appends `erasure`, `erasureCompleted` and `keyTombstone` here, anchors stay in the sinks. Joins `ControlStore`
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
  /**
   * Entries matching any lookup (at most 500), seq order, after `page.after` (default 0n), at most
   * `page.limit` (default 500). Subjects canonical.
   */
  find(
    lookups: readonly LedgerLookup[],
    page?: { readonly after?: bigint; readonly limit?: number },
  ): Promise<readonly { readonly seq: bigint; readonly record: LedgerRecord }[]>;
  /**
   * Erasure records after `after` with no erasureCompleted of the same identity after them at
   * `epochs.get(tenantId) ?? 0`, seq order, at most `limit`, narrowed to `tenantIds` when given;
   * `head` is the ledger's highest seq at the read (0n when empty).
   */
  unfinished(query: {
    readonly epochs: ReadonlyMap<string, number>;
    readonly after: bigint;
    readonly limit: number;
    readonly tenantIds?: readonly string[];
  }): Promise<{ readonly erasures: readonly UnfinishedErasure[]; readonly head: bigint }>;
}
