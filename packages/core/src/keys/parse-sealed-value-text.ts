import type { SealedValue } from '../storage/sealed-value.ts';

/** The sealed value a text names; `undefined` when the text is no `kwv1` reference. */
export function parseSealedValueText(text: string): SealedValue | undefined {
  const parts = text.split('.');
  const [version, keyId, nonce, ciphertext] = parts;
  if (parts.length !== 4 || version !== 'kwv1' || !keyId || !nonce || !ciphertext) return undefined;
  return {
    keyId,
    nonce: new Uint8Array(Buffer.from(nonce, 'base64url')),
    ciphertext: new Uint8Array(Buffer.from(ciphertext, 'base64url')),
  };
}
