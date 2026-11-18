/**
 * ISO/IEC 7816-4 padding: the plain bytes, one 0x80 byte, then zeros up to the next multiple of
 * `block`. A length that is a multiple already gains a whole block, so the padding is always
 * removable.
 */
export function padIso7816(plain: Uint8Array, block: number): Uint8Array {
  const padded = new Uint8Array((Math.floor(plain.length / block) + 1) * block);
  padded.set(plain);
  padded[plain.length] = 0x80;
  return padded;
}
