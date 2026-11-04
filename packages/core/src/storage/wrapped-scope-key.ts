/** A deployment, backend or tenant key, wrapped by its parent (S-55); one row of `kw_scope_keys`. */
export interface WrappedScopeKey {
  /** The deployment, backend or tenant id. */
  readonly scopeId: string;
  readonly level: 'deployment' | 'backend' | 'tenant';
  readonly version: number;
  readonly wrapped: Uint8Array;
  readonly createdAt: Temporal.Instant;
  readonly retiredAt: Temporal.Instant | null;
}
