import { encodeAad } from '@keelwerk/core';
import type { SqlKeyWrapper } from './sql-key-wrapper.ts';
import { sqlOpen } from './sql-open.ts';
import { sqlSeal } from './sql-seal.ts';

/**
 * A key wrapper under one 32-byte key: AES-256-GCM, the nonce in front of the ciphertext, the scope
 * id and the context as length-prefixed associated data parts. For tests only: a static key does not
 * shred a scope's keys when the scope is destroyed (14.7.4); the key service of the core wraps under
 * per-scope keys.
 */
export function aesKeyWrapper(key: Uint8Array, version = 1): SqlKeyWrapper {
  if (key.length !== 32) throw new TypeError('the wrapping key must be 32 bytes');
  const aadOf = (scopeId: string, context: Uint8Array): Uint8Array => encodeAad([scopeId, context]);
  return {
    version,
    wrap: async (scopeId, plain, context) => {
      const sealed = await sqlSeal(key, plain, aadOf(scopeId, context));
      return new Uint8Array([...sealed.nonce, ...sealed.ciphertext]);
    },
    unwrap: async (scopeId, wrapped, context) =>
      sqlOpen(key, wrapped.subarray(0, 12), wrapped.subarray(12), aadOf(scopeId, context)),
  };
}
