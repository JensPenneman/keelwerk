/** What `retention()` takes (section 14.7.1). */
export interface RetentionOptions {
  /** Between scheduled passes; default 3_600_000, on the runtime's timers. */
  readonly intervalMs?: number;
  /** Rows per unit and buffer; default 1000, 1 to 100000. */
  readonly batchSize?: number;
  /**
   * Batches of `batchSize` rows one buffer of one scope runs in one pass; default 100, 1 to
   * 1000000. A buffer that is not drained by then ends undrained, gets no horizon, and the next
   * pass takes it up again, so a backlog (the first pass after an upgrade) is spread over passes.
   */
  readonly maxBatchesPerPass?: number;
  /** Control rows per page of backends and tenants; default 100. */
  readonly pageSize?: number;
  /**
   * 'HH:MM' UTC: scheduled passes start only inside it, from `start` up to but not including
   * `end`; an end before the start crosses midnight, and a window whose start equals its end is
   * refused with `validation`. A scheduled pass also checks it before every batch and ends, the
   * buffer in hand undrained, when the window has closed. `pass()` ignores it.
   */
  readonly window?: { readonly start: string; readonly end: string };
  /**
   * ISO 8601 durations counted back from the pass: the receipt change records older than this
   * (default and least `defaultFeedHorizon`, 'P7D', the window a re-decide counts as retained; a
   * shorter one is refused with `validation`; no record of any other stream type is purged, the
   * entities of the kernel and its modules included, because a re-decide folds them) and the job
   * history older than this (default 'P7D').
   */
  readonly transientRecords?: string;
  readonly jobHistory?: string;
  /** ISO 8601 duration after a stream ticket's `expiresAt` before its row goes; default 'P1D'. */
  readonly streamTickets?: string;
}
