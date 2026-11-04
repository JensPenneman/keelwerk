/** One line of the fallback report: an absent capability, the kernel path that serves it and what that costs (14.3.3). */
export interface FallbackRow {
  /** The capability, named as in `AdapterCapabilities` (`rowLocks`, `changeFeed`, `encryptedQueries.order`, ...). */
  readonly capability: string;
  /** What the kernel runs instead. */
  readonly path: string;
  /** What the path costs. */
  readonly cost: string;
}
