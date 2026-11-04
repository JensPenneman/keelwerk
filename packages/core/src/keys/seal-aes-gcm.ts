import { createCipheriv } from 'node:crypto';
import { errors } from '../errors/errors.ts';
import type { RandomSource } from './random-source.ts';

/** AES-256-GCM output: a random 96-bit nonce and the ciphertext followed by the 16-byte tag. */
export interface AesGcmSealed {
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/** Seals `plain` under a 32-byte `key` with associated data `aad`; the nonce is always a fresh 96-bit random draw. */
export function sealAesGcm(
  key: Uint8Array,
  plain: Uint8Array,
  aad: Uint8Array,
  random: RandomSource,
): AesGcmSealed {
  if (key.length !== 32) throw errors.internal('AES-256-GCM needs a 32-byte key.');
  const nonce = random(12);
  if (nonce.length !== 12) throw errors.internal('A GCM nonce is 96 bits.');
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const body = cipher.update(plain);
  cipher.final();
  const ciphertext = new Uint8Array(body.length + 16);
  ciphertext.set(body);
  ciphertext.set(cipher.getAuthTag(), body.length);
  return { nonce, ciphertext };
}
