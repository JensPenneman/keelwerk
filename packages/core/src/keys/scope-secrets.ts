/** The secrets a write derives from the scope key, taken once before its unit opens. */
export interface ScopeSecrets {
  /**
   * The job key secret (`jobKeyInfo`): the part of a job key a module chose is stored as its digest
   * under it.
   */
  readonly jobKey: Uint8Array;
  /** The key of the keyed input fingerprint (`fingerprintKeyInfo`). */
  readonly fingerprintKey: Uint8Array;
  /**
   * The key that seals the state tokens of the scope (`stateTokenKey`), which a generated `set`
   * issues.
   */
  readonly stateTokenKey: Uint8Array;
}
