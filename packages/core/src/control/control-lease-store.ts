import type { ControlLease } from './control-lease.ts';

/**
 * Deployment-wide counts through leases (S-120), `ControlStore.leases`. A key names one count
 * across the deployment; a caller whose count is per scope or per tenant puts that scope or tenant
 * in the key. `scopeId` is stored and answered by `expire`, never part of a match. Now is the unit's clock.
 */
export interface ControlLeaseStore {
  /**
   * Upserts this holder's lease of (kind, key) with `expiresAt` = now + `ttlMs`, then answers the
   * units of every unexpired lease of (kind, key), this one included; a key names one count across
   * the deployment; a caller whose count is per scope or per tenant puts that scope or tenant in
   * the key. Holds and releases of one (kind, key) are serialised, so two first holds never both
   * answer only their own units (exact in a unit at read committed, the default of a writing unit).
   */
  hold(lease: Omit<ControlLease, 'expiresAt'>, ttlMs: number): Promise<{ readonly total: number }>;
  /** Deletes this holder's lease of (kind, key); a lease that is not there is no error. */
  release(kind: ControlLease['kind'], key: string, holder: string): Promise<void>;
  /**
   * The units of every unexpired lease of (kind, key), 0 when there is none; a key names one count
   * across the deployment; a caller whose count is per scope or per tenant puts that scope or
   * tenant in the key.
   */
  total(kind: ControlLease['kind'], key: string): Promise<number>;
  /**
   * Deletes up to `limit` leases of `kind` that expired at or before now, oldest first, and answers
   * each distinct (scopeId, key) among them that has no unexpired lease left. A deleted row is
   * answered to one caller only; a pair whose rows two callers deleted can reach both, and a pair
   * can gain a lease after it was answered, so a caller checks `total` before it acts.
   */
  expire(
    kind: ControlLease['kind'],
    limit: number,
  ): Promise<readonly { readonly scopeId: string | null; readonly key: string }[]>;
}
