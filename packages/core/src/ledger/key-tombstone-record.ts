/** A destroyed tenant or value key (section 14.7.6). Stored, final once written (S-176). */
export interface KeyTombstoneRecord {
  readonly type: 'keyTombstone';
  readonly scopeId: string;
  readonly keyId: string;
  /** ISO 8601 instant, like the anchor's. */
  readonly recordedAt: string;
  readonly reason: 'erasure' | 'rotation' | 'tenantDeleted';
}
