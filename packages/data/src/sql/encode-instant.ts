/** An instant as the millisecond-precision timestamp the framework columns hold (14.5.3). */
export function encodeInstant(value: Temporal.Instant): string {
  return Temporal.Instant.fromEpochMilliseconds(value.epochMilliseconds).toString();
}
