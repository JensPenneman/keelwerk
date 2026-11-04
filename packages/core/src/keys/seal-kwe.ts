import type { KweBinding } from './kwe-aad.ts';
import { kweAad } from './kwe-aad.ts';
import type { KweEnvelope } from './kwe-envelope.ts';
import type { RandomSource } from './random-source.ts';
import { sealAesGcm } from './seal-aes-gcm.ts';

/** Seals a personal chain value under the subject's data key. */
export function sealKwe(
  key: { readonly id: string; readonly material: Uint8Array },
  plain: Uint8Array,
  binding: KweBinding,
  random: RandomSource,
): KweEnvelope {
  const sealed = sealAesGcm(key.material, plain, kweAad(binding), random);
  return {
    $kwe: 1,
    k: key.id,
    n: Buffer.from(sealed.nonce).toString('base64url'),
    c: Buffer.from(sealed.ciphertext).toString('base64url'),
  };
}
