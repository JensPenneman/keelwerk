/** A key other than a host name that names a scope (gap G2). */
export interface ScopeKey {
  readonly kind:
    | 'hostname'
    | 'mail-domain'
    | 'webhook-endpoint'
    | 'node-credential'
    | 'api-key'
    | (string & {});
  readonly value: string;
}

/** Who holds a scope key. */
export interface ScopeKeyOwner {
  readonly module: string;
  readonly entity: string;
  readonly id: string;
}

/** Kernel-internal; module code returns the `claimScopeKey` and `releaseScopeKey` effects instead (gap G2). */
export interface ScopeDirectory {
  /** Unique across the deployment; `conflict` when another scope holds the key. */
  claim(key: ScopeKey, owner: ScopeKeyOwner): Promise<void>;
  release(key: ScopeKey, owner: ScopeKeyOwner): Promise<void>;
  resolve(
    key: ScopeKey,
  ): Promise<{ readonly backendId: string; readonly tenantId: string } | undefined>;
}
