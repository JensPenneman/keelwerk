import type { MasterKey } from './master-key-source.ts';
import type { RandomSource } from './random-source.ts';
import type { ScopeKeyBinding } from './scope-key-aad.ts';
import { scopeKeyAad } from './scope-key-aad.ts';
import { sealAesGcm } from './seal-aes-gcm.ts';

/**
 * Wraps a scope key under the master key: format byte 1, master key version (4 bytes, big endian),
 * nonce (12), ciphertext and tag. The binding is authenticated, so a wrapped key moved to another
 * scope, level or version does not unwrap.
 */
export function wrapKey(
  master: MasterKey,
  binding: ScopeKeyBinding,
  key: Uint8Array,
  random: RandomSource,
): Uint8Array {
  const sealed = sealAesGcm(master.material, key, scopeKeyAad(binding), random);
  const out = new Uint8Array(1 + 4 + 12 + sealed.ciphertext.length);
  out[0] = 1;
  new DataView(out.buffer).setUint32(1, master.version);
  out.set(sealed.nonce, 5);
  out.set(sealed.ciphertext, 17);
  return out;
}
