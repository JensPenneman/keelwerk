import type { KweBinding } from './kwe-aad.ts';
import { kweAad } from './kwe-aad.ts';
import type { KweEnvelope } from './kwe-envelope.ts';
import { padIso7816 } from './pad-iso7816.ts';
import type { RandomSource } from './random-source.ts';
import { sealAesGcm } from './seal-aes-gcm.ts';

/**
 * Seals a personal chain value under the subject's data key. Version 2 (the default) pads the
 * plaintext to a multiple of 32 bytes (ISO/IEC 7816-4) so that the ciphertext length does not tell
 * a boolean or a short enum value apart, and binds the version into the associated data. Version 1
 * keeps the plaintext as it is; only a caller that stores its own envelope form passes it.
 */
export function sealKwe(
  key: { readonly id: string; readonly material: Uint8Array },
  plain: Uint8Array,
  binding: KweBinding,
  random: RandomSource,
  version: 1 | 2 = 2,
): KweEnvelope {
  const sealed = sealAesGcm(
    key.material,
    version === 2 ? padIso7816(plain, 32) : plain,
    kweAad(binding, version),
    random,
  );
  return {
    $kwe: version,
    k: key.id,
    n: Buffer.from(sealed.nonce).toString('base64url'),
    c: Buffer.from(sealed.ciphertext).toString('base64url'),
  };
}
