import type { MasterKey } from './master-key-source.ts';
import { openAesGcm } from './open-aes-gcm.ts';
import type { ScopeKeyBinding } from './scope-key-aad.ts';
import { scopeKeyAad } from './scope-key-aad.ts';

/** Unwraps a key written by `wrapKey`; `undefined` when the format, binding or master key do not match. */
export async function unwrapKey(
  wrapped: Uint8Array,
  binding: ScopeKeyBinding,
  masterByVersion: (version: number) => Promise<MasterKey | undefined>,
): Promise<Uint8Array | undefined> {
  if (wrapped.length < 1 + 4 + 12 + 16 || wrapped[0] !== 1) return undefined;
  const version = new DataView(wrapped.buffer, wrapped.byteOffset, wrapped.byteLength).getUint32(1);
  const master = await masterByVersion(version);
  if (master === undefined) return undefined;
  return openAesGcm(
    master.material,
    wrapped.subarray(5, 17),
    wrapped.subarray(17),
    scopeKeyAad(binding),
  );
}
