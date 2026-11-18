import type { KweBinding } from './kwe-aad.ts';
import { kweAad } from './kwe-aad.ts';
import type { KweEnvelope } from './kwe-envelope.ts';
import { openAesGcm } from './open-aes-gcm.ts';
import { unpadIso7816 } from './unpad-iso7816.ts';

/**
 * Opens a chain value; `undefined` when the key is wrong or shredded (the caller passes none), the
 * binding or the version differs, or the padding of a version 2 envelope is broken.
 */
export function openKwe(
  envelope: KweEnvelope,
  key: Uint8Array | undefined,
  binding: KweBinding,
): Uint8Array | undefined {
  if (key === undefined) return undefined;
  const plain = openAesGcm(
    key,
    new Uint8Array(Buffer.from(envelope.n, 'base64url')),
    new Uint8Array(Buffer.from(envelope.c, 'base64url')),
    kweAad(binding, envelope.$kwe),
  );
  return envelope.$kwe === 2 && plain !== undefined ? unpadIso7816(plain) : plain;
}
