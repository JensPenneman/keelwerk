import type { ControlLease } from './control-lease.ts';

/** Deployment-wide counts through leases (S-120); joins `ControlStore` as `leases` in WP-95. */
export interface ControlLeaseStore {
  /** Upserts this holder's units; answers the live total of (kind, key). */
  hold(lease: Omit<ControlLease, 'expiresAt'>, ttlMs: number): Promise<{ readonly total: number }>;
  release(kind: ControlLease['kind'], key: string, holder: string): Promise<void>;
}
