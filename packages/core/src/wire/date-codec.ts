const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function dateToWire(date: Temporal.PlainDate): string {
  if (date.year < 0 || date.year > 9999) {
    throw new RangeError('a date outside the years 0000-9999 has no wire form');
  }
  return date.toString({ calendarName: 'never' });
}

function dateFromWire(text: string): Temporal.PlainDate | undefined {
  if (!isoDate.test(text)) {
    return undefined;
  }
  try {
    return Temporal.PlainDate.from(text, { overflow: 'reject' });
  } catch {
    return undefined;
  }
}

/** The codec of `date` fields: `YYYY-MM-DD` on the wire (section 16.2.3). */
export const dateCodec: {
  /** Throws a `RangeError` outside the years 0000-9999. */
  toWire(date: Temporal.PlainDate): string;
  /** The date of a `YYYY-MM-DD` string, or `undefined` when it is malformed or not a real day. */
  fromWire(text: string): Temporal.PlainDate | undefined;
} = { toWire: dateToWire, fromWire: dateFromWire };
