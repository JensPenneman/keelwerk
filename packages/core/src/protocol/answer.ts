/** An answer the kernel records in the decision record (S-50): ids, random values, the public parts of issued secrets. */
export type Answer =
  | { readonly kind: 'id'; readonly entity: string; readonly value: string }
  /** `value` is base64url. */
  | { readonly kind: 'random'; readonly bytes: number; readonly value: string }
  /** The public id and the verifier; never the plaintext. */
  | { readonly kind: 'secret'; readonly publicId: string; readonly verifier: string };
