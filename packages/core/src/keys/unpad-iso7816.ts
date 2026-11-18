/**
 * Removes ISO/IEC 7816-4 padding; `undefined` when the tail is not one 0x80 byte followed by zeros
 * only.
 */
export function unpadIso7816(padded: Uint8Array): Uint8Array | undefined {
  const end = padded.lastIndexOf(0x80);
  if (end < 0 || padded.subarray(end + 1).some((byte) => byte !== 0)) return undefined;
  return padded.subarray(0, end);
}
