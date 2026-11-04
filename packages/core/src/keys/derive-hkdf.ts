import { hkdfSync } from 'node:crypto';

/** HKDF-SHA-256 (RFC 5869) from `ikm`; an empty `salt` stands for the RFC's string of zeros. */
export function deriveHkdf(
  ikm: Uint8Array,
  salt: Uint8Array | string,
  info: Uint8Array | string,
  length: number,
): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', ikm, salt, info, length));
}
