const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const httpDate = /^[A-Z][a-z]{2}, (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

/**
 * The sunset date a `Sunset` header (`sunsetHeaderOf`) names, `YYYY-MM-DD`, or undefined for a text
 * that is no HTTP-date: the header is the first instant no longer served, so at midnight GMT the
 * date is the day before. Reads the one form the host writes, in GMT, with no time zone of the
 * process involved.
 */
export function sunsetDayOfHeader(header: string): string | undefined {
  const match = httpDate.exec(header.trim());
  if (match === null) return undefined;
  const month = months.indexOf(match[2] ?? '') + 1;
  if (month === 0) return undefined;
  try {
    const day = Temporal.PlainDate.from(
      { year: Number(match[3]), month, day: Number(match[1]) },
      { overflow: 'reject' },
    );
    const midnight = match[4] === '00' && match[5] === '00' && match[6] === '00';
    return (midnight ? day.subtract({ days: 1 }) : day).toString();
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}
