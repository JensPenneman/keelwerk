import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import { defaultRandomSource } from '../keys/default-random-source.ts';
import { encodeAad } from '../keys/encode-aad.ts';
import { openAesGcm } from '../keys/open-aes-gcm.ts';
import { sealAesGcm } from '../keys/seal-aes-gcm.ts';
import type { SubjectKeyStore } from '../storage/subject-key-store.ts';

/**
 * The value keys of a dry run: a value sealed during the run gets a key held in memory, so no
 * adapter wraps it under a scope key and no scope key is created for it. Values sealed before the
 * run open through the real store. Returns the function that wraps the key store of each unit the
 * run opens; they all share the one set of keys.
 */
export function dryRunValueKeys(): (inner: SubjectKeyStore) => SubjectKeyStore {
  const held = new Map<string, { readonly material: Uint8Array; readonly aad: Uint8Array }>();
  return (inner) => ({
    ...inner,
    sealValue: async (binding, plain) => {
      const keyId = newUuidV7();
      const material = defaultRandomSource(32);
      const aad = encodeAad([binding.entity, binding.id, binding.field]);
      const sealed = sealAesGcm(material, plain, aad, defaultRandomSource);
      held.set(keyId, { material, aad });
      return { keyId, nonce: sealed.nonce, ciphertext: sealed.ciphertext };
    },
    openValue: async (sealed) => {
      const key = held.get(sealed.keyId);
      return key === undefined
        ? inner.openValue(sealed)
        : openAesGcm(key.material, sealed.nonce, sealed.ciphertext, key.aad);
    },
    destroyValueKey: async (keyId) => {
      if (!held.delete(keyId)) await inner.destroyValueKey(keyId);
    },
  });
}
