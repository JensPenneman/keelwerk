/**
 * Wraps the key material the key stores keep in `kw_subject_keys` and `kw_value_keys` (14.7.4).
 * The runtime hands the adapters one through `AdapterEnvironment.keyWrapper`, backed by the key
 * service; `context` is bound into the wrapping, so a wrapped key moved to another row does not open.
 */
export interface ScopeKeyWrapper {
  /** Stored as `kek_version`. */
  readonly version: number;
  wrap(scopeId: string, plain: Uint8Array, context: Uint8Array): Promise<Uint8Array>;
  /** Throws when `wrapped` was not produced by `wrap` for this scope and context. */
  unwrap(scopeId: string, wrapped: Uint8Array, context: Uint8Array): Promise<Uint8Array>;
}
