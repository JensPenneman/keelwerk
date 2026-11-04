import type { KweBinding } from './kwe-aad.ts';
import { kweAad } from './kwe-aad.ts';
import type { KweEnvelope } from './kwe-envelope.ts';
import { openAesGcm } from './open-aes-gcm.ts';

/** Opens a chain value; `undefined` when the key is wrong or shredded (the caller passes none) or the binding differs. */
export function openKwe(
  envelope: KweEnvelope,
  key: Uint8Array | undefined,
  binding: KweBinding,
): Uint8Array | undefined {
  if (key === undefined) return undefined;
  return openAesGcm(
    key,
    new Uint8Array(Buffer.from(envelope.n, 'base64url')),
    new Uint8Array(Buffer.from(envelope.c, 'base64url')),
    kweAad(binding),
  );
}
