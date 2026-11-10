import { errors } from '../errors/errors.ts';
import { checkCookieToken } from './check-cookie-token.ts';
import { cookieAttributes } from './cookie-attributes.ts';

/**
 * A `Set-Cookie` value with the fixed attributes of section 16.4.10: the `__Host-` prefix,
 * `HttpOnly; Secure; SameSite=Lax; Path=/` and no `Domain`. `Max-Age` counts from `now`, the
 * invocation's clock (section 7.9).
 */
export function sessionCookie(
  name: string,
  value: string,
  now: Temporal.Instant,
  expires?: Date,
): string {
  checkCookieToken(name);
  if (!name.startsWith('__Host-')) {
    throw errors.internal(`The session cookie '${name}' must start with '__Host-'.`);
  }
  const lifetime =
    expires === undefined
      ? ''
      : `; Expires=${expires.toUTCString()}; Max-Age=${Math.max(0, Math.floor((expires.getTime() - now.epochMilliseconds) / 1000))}`;
  return `${name}=${encodeURIComponent(value)}; ${cookieAttributes}${lifetime}`;
}
