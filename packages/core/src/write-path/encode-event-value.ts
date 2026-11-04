/** A value as an event payload keeps it: JSON-safe, so an instant is its RFC 3339 text, a bigint its decimal text and bytes are base64url. */
export function encodeEventValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case 'bigint':
      return value.toString();
    case 'object':
      break;
    default:
      return value;
  }
  const tag: unknown = (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
  if (typeof tag === 'string' && tag.startsWith('Temporal.')) return String(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64url');
  if (value instanceof Set) return [...value].map(encodeEventValue);
  if (Array.isArray(value)) return value.map(encodeEventValue);
  const encoded: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(value)) {
    if (member !== undefined) encoded[name] = encodeEventValue(member);
  }
  return encoded;
}
