import { createDecipheriv } from 'node:crypto';

/** Opens a sealed value; `undefined` when the key, nonce, associated data or ciphertext do not match. */
export function openAesGcm(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Uint8Array | undefined {
  if (key.length !== 32 || nonce.length !== 12 || ciphertext.length < 16) return undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const body = decipher.update(ciphertext.subarray(0, ciphertext.length - 16));
    decipher.final();
    return new Uint8Array(body);
  } catch {
    return undefined;
  }
}
