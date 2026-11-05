import type { SecretRef } from '../ids/secret-ref.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import { sealedValueText } from './sealed-value-text.ts';

/** The reference text of a sealed value: `kwv1.<key id>.<nonce>.<ciphertext>` (nonce and ciphertext base64url). */
export function sealedValueRef(sealed: SealedValue): SecretRef {
  return { ref: sealedValueText(sealed) } as unknown as SecretRef;
}
