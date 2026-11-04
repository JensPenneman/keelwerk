/** A freshly issued secret: the plaintext goes to the caller once, the record keeps the public id and the verifier. */
export interface IssuedSecret {
  /** The visible part of the token. */
  readonly publicId: string;
  /** The whole token, `<prefix>_<publicId>_<secret>`; never stored or recorded. */
  readonly plain: string;
  /** What is stored to verify a presented token. */
  readonly verifier: string;
}
