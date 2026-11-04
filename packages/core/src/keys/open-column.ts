import { columnKeyId } from './column-key-id.ts';
import { openAesGcm } from './open-aes-gcm.ts';
import type { SealedColumnBinding } from './sealed-column-aad.ts';
import { sealedColumnAad } from './sealed-column-aad.ts';

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
  if (padded === undefined) return undefined;
  const end = padded.lastIndexOf(0x80);
  if (end < 0 || padded.subarray(end + 1).some((byte) => byte !== 0)) return undefined;
  return padded.subarray(0, end);
}
