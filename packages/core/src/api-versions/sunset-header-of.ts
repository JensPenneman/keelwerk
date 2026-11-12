import { declaredInstantOf } from './declared-instant-of.ts';
import { utcDayOf } from './utc-day-of.ts';

/**
 * The `Sunset` header value (RFC 8594, an HTTP-date) for a declared `sunset`, or undefined when the
 * text names no instant (`declaredInstantOf`). The header names the first instant at which the
 * version or the action is no longer served. The sunset date is the last day served, so that
 * instant is 00:00:00 GMT of the day after it; an instant counts by its UTC day. The one writer
 * both HTTP transports use (18.5).
 */
export function sunsetHeaderOf(sunset: string): string | undefined {
  const instant = declaredInstantOf(sunset);
  if (instant === undefined) return undefined;
  const next = Temporal.PlainDate.from(utcDayOf(instant)).add({ days: 1 });
  return new Date(next.toZonedDateTime('UTC').epochMilliseconds).toUTCString();
}
