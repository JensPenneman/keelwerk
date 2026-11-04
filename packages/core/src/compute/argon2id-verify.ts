import { timingSafeEqual } from '../crypto/timing-safe-equal.ts';
import { argon2idTag } from './argon2id-tag.ts';
import { parseArgon2idHash } from './parse-argon2id-hash.ts';

/**
 * Checks a password against a PHC string with the parameters the string carries, comparing the
 * recomputed tag with the stored one in constant time. A malformed string is `false`. Blocks the calling thread (see `argon2idHash`).
 */
export function argon2idVerify(verifier: string, password: string): boolean {
  const parsed = parseArgon2idHash(verifier);
  if (parsed === undefined) return false;
  return timingSafeEqual(argon2idTag(password, parsed.salt, parsed.params), parsed.tag);
}
