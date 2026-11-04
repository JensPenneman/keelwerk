const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const unpadded = /^[A-Za-z0-9_-]*$/;

/** Decodes unpadded base64url text (RFC 4648 section 5) to bytes, or `undefined` when it is malformed. */
export function decodeBase64Url(text: string): Uint8Array | undefined {
  if (!unpadded.test(text) || text.length % 4 === 1) {
    return undefined;
  }
  const last = alphabet.indexOf(text.charAt(text.length - 1));
  const spare = text.length % 4 === 2 ? 15 : text.length % 4 === 3 ? 3 : 0;
  if ((last & spare) !== 0) {
    return undefined;
  }
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of text) {
    buffer = (buffer << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(bytes);
}
