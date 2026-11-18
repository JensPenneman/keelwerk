/** The `$kwe` form of a personal value in the chain (14.7.4); every binary field is base64url without padding. */
export interface KweEnvelope {
  /**
   * 1 as 0.1.0 wrote it; 2 pads the plaintext to a multiple of 32 bytes and binds the version in
   * the associated data.
   */
  readonly $kwe: 1 | 2;
  /** The data key id. */
  readonly k: string;
  /** The 96-bit nonce. */
  readonly n: string;
  /** The ciphertext followed by the GCM tag. */
  readonly c: string;
}
