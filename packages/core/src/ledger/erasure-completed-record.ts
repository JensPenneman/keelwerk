/**
 * An erasure's steps 2 to 6 finished in its tenant at that epoch (section 14.7.5). Stored, final once
 * written. It lives in the control ledger only and never in a sink: sinks are what survives a
 * restore, and a completion must not. It counts for an erasure record only when it stands after
 * that record in the control ledger (ledger order, never clock time).
 */
export interface ErasureCompletedRecord {
  readonly type: 'erasureCompleted';
  readonly tenantId: string;
  readonly commandId: string;
  /** The erased subject in its canonical form: the erasure is identified by tenant, command id and subject. */
  readonly subjectId: string;
  /** The tenant scope's epoch when the steps finished. */
  readonly epoch: number;
  /** ISO 8601 instant, like the anchor's. */
  readonly recordedAt: string;
}
