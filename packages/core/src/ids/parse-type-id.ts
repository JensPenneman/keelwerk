const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
const prefixPattern = /^(?:[a-z](?:[a-z_]{0,61}[a-z])?)?$/;

/**
 * Parses a TypeID of the expected prefix back to its canonical lower-case UUID, or `undefined`
 * when the text is malformed, the prefix differs or the suffix overflows 128 bits.
 */
export function parseTypeId(text: string, prefix: string): string | undefined {
  if (!prefixPattern.test(prefix)) {
    return undefined;
  }
  const split = text.lastIndexOf('_');
  const suffix = prefix === '' ? text : text.slice(split + 1);
  if (prefix === '' ? split !== -1 : text.slice(0, split) !== prefix || split === -1) {
    return undefined;
  }
  if (suffix.length !== 26 || suffix.charAt(0) > '7') {
    return undefined;
  }
  let value = 0n;
  for (const character of suffix) {
    const digit = alphabet.indexOf(character);
    if (digit === -1) {
      return undefined;
    }
    value = (value << 5n) | BigInt(digit);
  }
  const hex = value.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
