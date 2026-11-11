import { sha256 } from '../crypto/sha256.ts';

/**
 * The position of a targeting key in a split: the first four bytes, big-endian, of
 * SHA-256(UTF-8(salt + ':' + targetingKey)), an unsigned integer in [0, 2^32). A stored contract:
 * changing it moves every key of every raised flag.
 */
export function splitHash(salt: string, targetingKey: string): number {
  return Number.parseInt(sha256(`${salt}:${targetingKey}`).slice(0, 8), 16);
}
