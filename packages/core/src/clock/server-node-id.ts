const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';

/**
 * The node id a process registers with (section 14.5.3): `s` and ten lower-case Crockford base32
 * characters, drawn from the first 50 of the given random bits. The runtime supplies the randomness.
 */
export function serverNodeId(bytes: Uint8Array): string {
  if (bytes.length < 7) throw new RangeError('A server node id needs at least 7 random bytes.');
  let bits = 0n;
  for (const byte of bytes.subarray(0, 7)) bits = (bits << 8n) | BigInt(byte);
  let id = 's';
  for (let index = 0; index < 10; index += 1) {
    const shift = BigInt(56 - 5 * (index + 1));
    id += alphabet[Number((bits >> shift) & 31n)];
  }
  return id;
}
