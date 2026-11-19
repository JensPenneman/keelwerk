/** What `settleEffects` found out. */
export interface EffectSettling<T> {
  /** The latest status of each found id, in the order of the ids given. */
  readonly statuses: readonly T[];
  /** The ids a watch had no status for at its first `head` (or after a reset, at the next one). */
  readonly missing: readonly string[];
  /** Every found status was settled (not `requested`) before the timeout. */
  readonly settled: boolean;
}
