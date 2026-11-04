/** The `$kwe` form of a personal value in the chain (14.7.4); every binary field is base64url without padding. */
export interface KweEnvelope {
  readonly $kwe: 1;
  /** The data key id. */
  readonly k: string;
  /** The 96-bit nonce. */
  readonly n: string;
  /** The ciphertext followed by the GCM tag. */
  readonly c: string;
}
