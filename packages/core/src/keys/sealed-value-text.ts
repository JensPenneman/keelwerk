import type { SealedValue } from '../storage/sealed-value.ts';

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** The stored text of a sealed value: `kwv1.<key id>.<nonce>.<ciphertext>` (nonce and ciphertext base64url). Events and loaded references carry this form. */
export function sealedValueText(sealed: SealedValue): string {
  return `kwv1.${sealed.keyId}.${b64(sealed.nonce)}.${b64(sealed.ciphertext)}`;
}
