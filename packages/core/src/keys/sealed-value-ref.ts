import type { SecretRef } from '../ids/secret-ref.ts';
import type { SealedValue } from '../storage/sealed-value.ts';

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** The reference text of a sealed value: `kwv1.<key id>.<nonce>.<ciphertext>` (nonce and ciphertext base64url). */
export function sealedValueRef(sealed: SealedValue): SecretRef {
  const text = `kwv1.${sealed.keyId}.${b64(sealed.nonce)}.${b64(sealed.ciphertext)}`;
  return { ref: text } as unknown as SecretRef;
}
