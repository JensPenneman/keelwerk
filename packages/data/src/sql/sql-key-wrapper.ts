import type { ScopeKeyStore } from '@keelwerk/core';

/**
 * Wraps the key material the key stores keep in `kw_subject_keys` and `kw_value_keys` (14.7.4).
 * The key service of the core provides the real one, backed by the scope's key; the adapters take
 * it as an option. `context` is bound into the wrapping (the key id), so a wrapped key moved to
 * another row does not open.
 */
export interface SqlKeyWrapper {
  /** Stored as `kek_version`. */
  readonly version: number;
  wrap(scopeId: string, plain: Uint8Array, context: Uint8Array): Promise<Uint8Array>;
  /** Throws when `wrapped` was not produced by `wrap` for this scope and context. */
  unwrap(scopeId: string, wrapped: Uint8Array, context: Uint8Array): Promise<Uint8Array>;
  /** The same wrapper reading the scope keys through the store of the deployment-scope unit that is open. */
  within?(store: ScopeKeyStore): SqlKeyWrapper;
}
