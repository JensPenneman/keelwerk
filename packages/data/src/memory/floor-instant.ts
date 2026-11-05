/** The instant cut to whole milliseconds, the precision the SQL tables keep. */
export function floorInstant(instant: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(instant.epochMilliseconds);
}
