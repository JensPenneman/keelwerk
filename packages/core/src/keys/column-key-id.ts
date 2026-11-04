import { sealedColumnFormat } from './sealed-column-format.ts';

/** The key id (UUID text) a sealed column names, so the caller can fetch the data key; `undefined` for a malformed value. */
export function columnKeyId(sealed: Uint8Array): string | undefined {
  if (sealed.length < 1 + 16 + 12 + 16 + 16 || sealed[0] !== sealedColumnFormat) return undefined;
  const h = Buffer.from(sealed.subarray(1, 17)).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
