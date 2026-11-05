import { checkCookieToken } from './check-cookie-token.ts';
import { cookieAttributes } from './cookie-attributes.ts';

/** The `Set-Cookie` value that removes a cookie (`Max-Age=0`). */
export function clearedCookie(name: string): string {
  checkCookieToken(name);
  return `${name}=; ${cookieAttributes}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`;
}
