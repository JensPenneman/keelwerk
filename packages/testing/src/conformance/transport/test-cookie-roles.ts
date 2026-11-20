import { cookieValueOf } from './cookie-value-of.ts';
import { testCookieName } from './test-cookie-name.ts';

/** The roles of a test session cookie in a `Cookie` header: those of the role form `user+<role>+<role>:<subject>`; `user:<subject>` and any other value hold none. */
export function testCookieRoles(header: string | undefined): readonly string[] {
  const held = cookieValueOf(header, testCookieName);
  const roles = held === undefined ? undefined : /^user\+([^:]+):/.exec(held)?.[1];
  return roles === undefined ? [] : roles.split('+');
}
