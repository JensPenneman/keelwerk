import { isCalendarDate } from './is-calendar-date.ts';

/**
 * The instant a declared date names, or undefined when the text is not one: a calendar date
 * (`YYYY-MM-DD`) is the start of that UTC day, an instant with an offset (`Z` or `+hh:mm`) is
 * itself. A date-time without an offset and any other text name no instant, whatever the process
 * time zone is. The one reader of an action's `deprecated.at` and `sunset` (18.5): nothing else
 * parses them.
 */
export function declaredInstantOf(text: string): Temporal.Instant | undefined {
  if (isCalendarDate(text)) {
    return Temporal.PlainDate.from(text).toZonedDateTime('UTC').toInstant();
  }
  try {
    return Temporal.Instant.from(text);
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}
