/** The UTC calendar date of `at`, `YYYY-MM-DD`: "today" of every version and usage rule. */
export function utcDayOf(at: Temporal.Instant): string {
  return at.toZonedDateTimeISO('UTC').toPlainDate().toString();
}
