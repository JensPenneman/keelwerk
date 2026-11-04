import { keyIdBytes } from './key-id-bytes.ts';
import type { RandomSource } from './random-source.ts';
import { sealAesGcm } from './seal-aes-gcm.ts';
import type { SealedColumnBinding } from './sealed-column-aad.ts';
import { sealedColumnAad } from './sealed-column-aad.ts';
import { sealedColumnFormat } from './sealed-column-format.ts';

/**
 * The binary form of a sealed personal value: format byte, key id (16), nonce (12), the value
 * padded to a multiple of 16 bytes (ISO/IEC 7816-4: 0x80, then zeros; a value of exactly 16k
 * bytes gains a block), GCM tag (16). Padding hides the exact length.
 */
export function sealColumn(
  key: { readonly id: string; readonly material: Uint8Array },
  plain: Uint8Array,
  binding: SealedColumnBinding,
  random: RandomSource,
): Uint8Array {
  const id = keyIdBytes(key.id);
  const padded = new Uint8Array((Math.floor(plain.length / 16) + 1) * 16);
  padded.set(plain);
  padded[plain.length] = 0x80;
  const sealed = sealAesGcm(key.material, padded, sealedColumnAad(binding, id), random);
  const out = new Uint8Array(1 + 16 + 12 + sealed.ciphertext.length);
  out[0] = sealedColumnFormat;
  out.set(id, 1);
  out.set(sealed.nonce, 17);
  out.set(sealed.ciphertext, 29);
  return out;
}
