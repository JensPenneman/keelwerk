/** The instant of an `asOf` input: an instant value or its RFC 3339 text. */
export function asOfInstant(value: unknown): Temporal.Instant {
  return Temporal.Instant.from(String(value));
}
