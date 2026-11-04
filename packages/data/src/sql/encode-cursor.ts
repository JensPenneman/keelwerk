/** The JSON form of a sort value: the inverse of `decodeCursor`'s per-kind reading. */
function jsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64url');
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Temporal.Instant || value instanceof Temporal.PlainDate) {
    return value.toString();
  }
  return value;
}

/**
 * Encodes a cursor as `base64url(JSON [sort values..., id, signature])` (section 14.3.5). The
 * values are the sort fields of one row in the domain form (`Temporal`, `bigint`, bytes); an
 * absent value is `null`.
 */
export function encodeCursor(values: readonly unknown[], id: string, signature: string): string {
  return Buffer.from(JSON.stringify([...values.map(jsonValue), id, signature]), 'utf8').toString(
    'base64url',
  );
}
