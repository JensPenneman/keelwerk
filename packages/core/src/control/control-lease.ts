/**
 * One row of kw__control.kw_leases (sections 12.2, 15.4.9 and 15.4.10, S-120), keyed by
 * (kind, key, holder).
 */
export interface ControlLease {
  readonly kind: 'topic' | 'subscriptions' | 'connections' | 'invocations';
  readonly scopeId: string | null;
  readonly key: string;
  /** The process holding the units. */
  readonly holder: string;
  readonly units: number;
  readonly expiresAt: Temporal.Instant;
}
