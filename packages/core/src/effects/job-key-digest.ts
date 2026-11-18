import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import { encodeAad } from '../keys/encode-aad.ts';

/**
 * The part of a job key that a module or a reaction chose, as it is stored: HMAC-SHA-256 under the
 * job key secret of the scope (`jobKeyInfo`) of the owner and the part, as 64 lower-case
 * hexadecimal characters. The owner is the prefix that is stored with the digest (the module, or
 * the reaction id), and the two are length-prefixed before they are hashed, so the same part of two
 * owners gives two digests and no owner and part that concatenate alike collide. A key built from
 * a personal value never reaches `kw_jobs` in the clear, the same part of the same owner always
 * gives the same digest within a scope (so cancel, replace, coalesce and ordering still find their
 * job), and a digest holds no colon, so it cannot spell the kernel's namespace.
 *
 * A digest protects a part against whoever holds a dump or a backup without the master key. It does
 * not survive an erasure as a secret: whoever holds the master key and the control store can check
 * a guessed part against every key that outlives the erasure. A module puts no personal value in a
 * key and uses a random id that stands for the person.
 */
export function jobKeyDigest(secret: Uint8Array, owner: string, part: string): string {
  return hmacSha256(secret, encodeAad([owner, part]));
}
