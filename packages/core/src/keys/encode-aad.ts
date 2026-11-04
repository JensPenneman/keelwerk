const encoder = new TextEncoder();

/**
 * Associated data from ordered parts (`namespace ‖ stream id ‖ event id ‖ field` and the like):
 * each part is a 4-byte big-endian length followed by its bytes, so no two part lists encode alike.
 */
export function encodeAad(parts: readonly (string | Uint8Array)[]): Uint8Array {
  const encoded = parts.map((part) => (typeof part === 'string' ? encoder.encode(part) : part));
  const out = new Uint8Array(encoded.reduce((sum, part) => sum + 4 + part.length, 0));
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const part of encoded) {
    view.setUint32(offset, part.length);
    out.set(part, offset + 4);
    offset += 4 + part.length;
  }
  return out;
}
