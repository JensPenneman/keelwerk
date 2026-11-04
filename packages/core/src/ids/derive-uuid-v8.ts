import { sha256 } from '../crypto/sha256.ts';

const encoder = new TextEncoder();

/**
 * A deterministic UUID (RFC 9562 version 8) from SHA-256 of the parts, for the stream ids of
 * external entities and for command receipts (section 14.5.2). Each part is length-prefixed
 * (4 bytes, big-endian, then its UTF-8 bytes), so no two part lists hash the same input.
 */
export function deriveUuidV8(...parts: readonly string[]): string {
  const chunks = parts.map((part) => encoder.encode(part));
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + 4 + chunk.length, 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.length);
    bytes.set(chunk, offset + 4);
    offset += 4 + chunk.length;
  }
  const hex = sha256(bytes);
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0b11) | 0b1000).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
