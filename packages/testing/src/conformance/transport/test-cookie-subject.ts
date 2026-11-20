import { cookieValueOf } from './cookie-value-of.ts';
import { testCookieName } from './test-cookie-name.ts';

/**
 * The subject of a test session cookie in a `Cookie` header (`__Host-kw-test=user:<subject>`, or the
 * role form `user+<role>+<role>:<subject>`), or undefined for no cookie or a stale one.
 */
export function testCookieSubject(header: string | undefined): string | undefined {
  const held = cookieValueOf(header, testCookieName);
  return held === undefined ? undefined : /^user(?:\+[^:]+)?:(.*)$/s.exec(held)?.[1];
}
