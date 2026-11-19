/**
 * A rule as one run applied it. `receipts.olderThan` null: each receipt's own `expiresAt` (its
 * action's idempotency window). A rule without an `adopted` member is a default or a configured
 * rule; adoption by a person adds the member later.
 */
export type RetentionRunRule =
  | { readonly kind: 'transientRecords'; readonly olderThan: string }
  | { readonly kind: 'receipts'; readonly olderThan: null }
  | { readonly kind: 'jobHistory'; readonly olderThan: string }
  | { readonly kind: 'streamTickets'; readonly olderThan: string }
  | {
      readonly kind: 'streamRecords';
      readonly stream: string;
      readonly maxAge?: string;
      readonly maxPerKey?: number;
    };

/**
 * What one run removed, by buffer. A member is present only for a buffer the scope applied in this
 * pass: the deployment scope has no ticket buffer, so it never has `streamTickets`.
 */
export interface RetentionRemoved {
  readonly transientRecords?: number;
  readonly receipts?: number;
  /** Value keys of purged receipts' outcomes destroyed; present with `receipts`. */
  readonly valueKeys?: number;
  readonly jobHistory?: number;
  readonly streamTickets?: number;
  /** By stream ref; one member for each stream with a declared retention that the scope applied. */
  readonly streamRecords?: Readonly<Record<string, number>>;
}

/**
 * ISO 8601 instants with three fractional digits. A member is present for a buffer only when its
 * step of this pass ended with a batch that found nothing left and no failure, which means nothing
 * older than the horizon is left in that buffer of that scope; a buffer that did not drain (it used
 * its batches of the pass, the window closed, the lease was lost or a unit failed), or never ran,
 * has no member, and a reader must not take its absence for a horizon. What each is compared with:
 * `transientRecords` with `recorded_at`, and it covers the stream types of `transientPurgeTypes`
 * only (the change records of receipts): no record of any other stream type is purged, the
 * entities of the kernel and its modules included, so a changes token over them is not cut by it;
 * the newest record of each stream is kept whatever its age while the receipt of the stream exists
 * (the one that goes is that of a receipt stream whose receipt row is gone), and a record that
 * carries a hash or a previous hash is never touched; `receipts` with the `expiresAt` of completed
 * and failed receipts (a pending or accepted receipt stays until it finishes, and one that names a
 * sync client until the client acknowledged it); `jobHistory` with `finished_at`; `streamTickets`
 * with the ticket's `expiresAt`.
 */
export interface RetentionHorizons {
  readonly transientRecords?: string;
  readonly receipts?: string;
  readonly jobHistory?: string;
  readonly streamTickets?: string;
}

/**
 * One kw_retention_runs row (S-172): one namespace's share of one scope's pass. Stored, final once
 * written; a reader ignores members it does not know.
 */
export interface RetentionRun {
  /** A UUIDv7. */
  readonly runId: string;
  readonly startedAt: Temporal.Instant;
  readonly endedAt: Temporal.Instant;
  /**
   * The id of the namespace that served the pass; one scope served from two namespaces gives two
   * rows. Null only for a row that carries none (a column the owner left empty): a reader never
   * takes null for a namespace.
   */
  readonly namespaceId: string | null;
  /** The deployment id for the deployment scope. */
  readonly backendId: string;
  /** Null whenever the scope is not a tenant. */
  readonly tenantId: string | null;
  /**
   * `complete`, or `failed` when a unit of the scope failed, also before it removed anything. Stored
   * and read as written, with no mapping: only the text `complete` is complete; null and any other
   * text (a later version may write one, `partial` say) are not, and a reader must not take them
   * for a failure that happened.
   */
  readonly outcome: string | null;
  /** The kind and code of the failure, never its message or any value; null when complete. */
  readonly error: { readonly kind: string; readonly code: string } | null;
  /** The rules the scope applied in this pass. */
  readonly rule: { readonly rules: readonly RetentionRunRule[] };
  readonly removed: RetentionRemoved;
  readonly horizons: RetentionHorizons;
}
