import { createHmac } from 'node:crypto';
import { errors } from '../errors/errors.ts';

/**
 * The blind index tag of a normalised value (14.7.9.4): HMAC-SHA-256 under the field's equality
 * key, 128 bits unless `bits` truncates it (8 to 128). Truncation keeps whole bytes and clears the
 * unused low bits of the last one.
 */
export function eqTag(fieldKey: Uint8Array, normalised: string, bits = 128): Uint8Array {
  if (!Number.isInteger(bits) || bits < 8 || bits > 128) {
    throw errors.internal('An equality tag keeps 8 to 128 bits.');
  }
  const full = createHmac('sha256', fieldKey).update(normalised, 'utf8').digest();
  const tag = new Uint8Array(full.subarray(0, Math.ceil(bits / 8)));
  const spare = tag.length * 8 - bits;
  if (spare > 0) tag[tag.length - 1] = (tag.at(-1) ?? 0) & (0xff << spare) & 0xff;
  return tag;
}
