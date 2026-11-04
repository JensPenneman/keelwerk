/** What a driver returns for a `bytea` column (`Buffer`, `Uint8Array` or hex text) as plain bytes. */
export function decodeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (typeof value === 'string' && value.startsWith('\\x')) {
    return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
  }
  throw new TypeError(`expected bytes, got ${typeof value}`);
}
