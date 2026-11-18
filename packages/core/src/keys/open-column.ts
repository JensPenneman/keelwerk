import { columnKeyId } from './column-key-id.ts';
import { openAesGcm } from './open-aes-gcm.ts';
import type { SealedColumnBinding } from './sealed-column-aad.ts';
import { sealedColumnAad } from './sealed-column-aad.ts';
import { unpadIso7816 } from './unpad-iso7816.ts';

/** Opens a sealed column value; `undefined` when moved to another row, field or key, tampered with, or the key is gone. */
export function openColumn(
  sealed: Uint8Array,
  key: Uint8Array | undefined,
  binding: SealedColumnBinding,
): Uint8Array | undefined {
  if (key === undefined || columnKeyId(sealed) === undefined) return undefined;
  const padded = openAesGcm(
    key,
    sealed.subarray(17, 29),
    sealed.subarray(29),
    sealedColumnAad(binding, sealed.subarray(1, 17)),
  );
  return padded === undefined ? undefined : unpadIso7816(padded);
}
