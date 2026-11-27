/** A destroyed tenant or value key (section 14.7.6). Stored, final once written (S-176). */
export interface KeyTombstoneRecord {
  readonly type: 'keyTombstone';
  readonly scopeId: string;
  readonly keyId: string;
  /** ISO 8601 instant, like the anchor's. */
  readonly recordedAt: string;
  readonly reason: 'erasure' | 'rotation' | 'tenantDeleted';
  /**
   * The command id of the erasure that recorded the tombstone, on the tombstones an erasure
   * records for the value keys of rows, jobs, requests, principals and effects (it finds the keys
   * of its own rows again after a crash by it). Absent from the tombstone of a subject's data key
   * and from a record written before it existed. A sink receives it and must accept it.
   */
  readonly commandId?: string;
}
