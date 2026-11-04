/** A value sealed under its own value key: credential material and sealed inputs (section 7.9.6). */
export interface SealedValue {
  readonly keyId: string;
  readonly nonce: Uint8Array;
  /** Ciphertext with the GCM tag. */
  readonly ciphertext: Uint8Array;
}
