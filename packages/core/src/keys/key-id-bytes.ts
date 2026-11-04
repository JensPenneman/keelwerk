import { errors } from '../errors/errors.ts';
/** The 16 bytes of a canonical UUID text; throws when the key id is no UUID. */
export function keyIdBytes(keyId: string): Uint8Array {
  const hex = keyId.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/.test(hex)) throw errors.internal('A key id is a UUID.');
  return new Uint8Array(Buffer.from(hex, 'hex'));
}
