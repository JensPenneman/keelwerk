/**
 * A value in a form `toEqual` compares exactly: Temporal values and bigints as tagged text,
 * bytes as hex, sets as sorted arrays. Temporal objects have no enumerable members, so comparing
 * them directly would equate any two.
 */
export function plainValue(value: unknown): unknown {
  if (value instanceof Temporal.Instant) return `instant:${value.toString()}`;
  if (value instanceof Temporal.PlainDate) return `date:${value.toString()}`;
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (value instanceof Uint8Array) return `bytes:${Buffer.from(value).toString('hex')}`;
  if (value instanceof Set) {
    return { set: [...value].map(plainValue).sort((a, b) => String(a).localeCompare(String(b))) };
  }
  if (Array.isArray(value)) return value.map(plainValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, member]) => member !== undefined)
        .map(([name, member]) => [name, plainValue(member)]),
    );
  }
  return value;
}
