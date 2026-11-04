const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Encodes bytes as unpadded base64url text (RFC 4648 section 5). */
export function encodeBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const group = (first << 16) | (second << 8) | third;
    const left = bytes.length - index;
    text += alphabet.charAt((group >> 18) & 63) + alphabet.charAt((group >> 12) & 63);
    if (left > 1) {
      text += alphabet.charAt((group >> 6) & 63);
    }
    if (left > 2) {
      text += alphabet.charAt(group & 63);
    }
  }
  return text;
}
