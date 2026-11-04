import { argon2Sync } from 'node:crypto';
import { errors } from '../errors/errors.ts';
import type { Argon2idParams } from './argon2id-params.ts';

/** The raw Argon2id tag of `password`; blocks the calling thread (see `argon2idHash`). `salt` is at least 16 bytes. */
export function argon2idTag(
  password: string,
  salt: Uint8Array,
  params: Argon2idParams,
): Uint8Array {
  if (salt.length < 16) throw errors.internal('An Argon2id salt has at least 16 bytes.');
  return argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    parallelism: params.parallelism,
    tagLength: params.tagLength,
    memory: params.memoryKib,
    passes: params.passes,
  });
}
