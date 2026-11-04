const rfc3339Instant = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

function instantToWire(instant: Temporal.Instant): string {
  const year = instant.toZonedDateTimeISO('UTC').year;
  if (year < 0 || year > 9999) {
    throw new RangeError('an instant outside the years 0000-9999 has no wire form');
  }
  return instant
    .round({ smallestUnit: 'millisecond', roundingMode: 'floor' })
    .toString({ fractionalSecondDigits: 3 });
}

function instantFromWire(text: string): Temporal.Instant | undefined {
  if (!rfc3339Instant.test(text)) {
    return undefined;
  }
  try {
    return Temporal.Instant.from(text).round({
      smallestUnit: 'millisecond',
      roundingMode: 'floor',
    });
  } catch {
    return undefined;
  }
}

/**
 * The codec of `instant` fields (section 6.4). On the wire an instant is RFC 3339 in UTC with `Z`
 * and milliseconds, finer digits rounded down; the decoder takes `Z` or an offset. It uses the
 * global `Temporal`, never an import.
 */
export const instantCodec: {
  /** Throws a `RangeError` outside the years 0000-9999. */
  toWire(instant: Temporal.Instant): string;
  /** The instant of an RFC 3339 string rounded down to milliseconds, or `undefined`. */
  fromWire(text: string): Temporal.Instant | undefined;
} = { toWire: instantToWire, fromWire: instantFromWire };
