const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
const prefixPattern = /^(?:[a-z](?:[a-z_]{0,61}[a-z])?)?$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Renders a UUID as a TypeID (specification 0.3.0): the prefix, an underscore and the 26 characters
 * of the 128 bits in Crockford base32. An empty prefix renders the suffix alone. Throws a
 * `TypeError` for a malformed prefix or a UUID that is not canonical lower case.
 */
export function renderTypeId(prefix: string, uuid: string): string {
  if (!prefixPattern.test(prefix)) {
    throw new TypeError(`'${prefix}' is not a TypeID prefix`);
  }
  if (!uuidPattern.test(uuid)) {
    throw new TypeError(`'${uuid}' is not a canonical lower-case UUID`);
  }
  let rest = BigInt(`0x${uuid.replaceAll('-', '')}`);
  let suffix = '';
  for (let index = 0; index < 26; index += 1) {
    suffix = `${alphabet.charAt(Number(rest & 31n))}${suffix}`;
    rest >>= 5n;
  }
  return prefix === '' ? suffix : `${prefix}_${suffix}`;
}
