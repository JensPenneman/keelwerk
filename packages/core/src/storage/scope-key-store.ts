import type { WrappedScopeKey } from './wrapped-scope-key.ts';

/** Wrapped scope keys in the control root, on deployment-scope units (S-55, section 14.7.4). */
export interface ScopeKeyStore {
  current(scopeId: string): Promise<WrappedScopeKey | undefined>;
  byVersion(scopeId: string, version: number): Promise<WrappedScopeKey | undefined>;
  add(key: WrappedScopeKey): Promise<void>;
  retire(scopeId: string, version: number, at: Temporal.Instant): Promise<void>;
  /** Tenant retirement: deletes every wrapped version, which makes the tenant's data unreadable. */
  destroy(scopeId: string): Promise<void>;
}
