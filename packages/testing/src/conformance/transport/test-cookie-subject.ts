import { cookieValueOf } from './cookie-value-of.ts';
import { testCookieName } from './test-cookie-name.ts';

/** The subject of a test session cookie (`__Host-kw-test=user:<subject>`) in a `Cookie` header, or undefined for no cookie or a stale one. */
export function testCookieSubject(header: string | undefined): string | undefined {
  const held = cookieValueOf(header, testCookieName);
  return held?.startsWith('user:') === true ? held.slice('user:'.length) : undefined;
}
