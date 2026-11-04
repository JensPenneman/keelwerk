import type { Argon2idParams } from './argon2id-params.ts';
import { argon2idParams } from './argon2id-params.ts';
import { argon2idTag } from './argon2id-tag.ts';

const unpadded = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64').replace(/=+$/, '');

/**
 * Argon2id as a PHC string `$argon2id$v=19$m=…,t=…,p=…$<salt>$<tag>` (unpadded base64), so the
 * parameters travel with the hash. Blocks the calling thread for the whole computation: the
 * compute pool's workers call it, nothing else should. `salt` is at least 16 bytes.
 */
export function argon2idHash(
  password: string,
  salt: Uint8Array,
  params: Argon2idParams = argon2idParams,
): string {
  const tag = argon2idTag(password, salt, params);
  return `$argon2id$v=19$m=${params.memoryKib},t=${params.passes},p=${params.parallelism}$${unpadded(salt)}$${unpadded(tag)}`;
}
