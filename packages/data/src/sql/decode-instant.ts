/** What a driver returns for a `timestamptz` column (a `Date` or text) as an instant. */
export function decodeInstant(value: unknown): Temporal.Instant {
  if (value instanceof Date) return Temporal.Instant.fromEpochMilliseconds(value.getTime());
  if (typeof value === 'string') return Temporal.Instant.from(value);
  throw new TypeError(`expected a timestamp, got ${typeof value}`);
}
