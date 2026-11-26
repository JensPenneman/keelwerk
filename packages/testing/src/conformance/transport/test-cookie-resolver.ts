import type { AnsweredPrincipal, PrincipalResolver } from '@keelwerk/core';
import type { TestPrincipalBook } from '../../harness/test-principal-book.ts';
import { cookieValueOf } from './cookie-value-of.ts';
import { testCookieName } from './test-cookie-name.ts';
import { testCookieRoles } from './test-cookie-roles.ts';
import { testCookieSubject } from './test-cookie-subject.ts';

/**
 * The test session cookie until the auth module's resolver lands: `__Host-kw-test=user:<subject>`
 * is that user with no roles, and `user+<role>+<role>:<subject>` is that user holding those roles
 * (cookie value characters only). Any other value, and the session of a subject the test revoked
 * (`book`), in either form, is a stale session, answered as anonymous with the cookie cleared and no
 * expiry (16.3.4), as the auth module's resolver answers a logged-out or revoked session: it does
 * not fail, so a public action still works and the browser forgets the cookie.
 */
export function testCookieResolver(
  book: TestPrincipalBook = { seen: new Map(), revoked: new Set() },
): PrincipalResolver {
  return {
    id: 'test.cookie',
    describe: () => ({ scheme: 'cookie', name: testCookieName }),
    // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
    *resolve(carrier, ctx) {
      const held = cookieValueOf(carrier.headers?.cookie, testCookieName);
      if (held === undefined) return null;
      const scope = {
        backend: ctx.scope.level === 'deployment' ? null : ctx.scope.backendId,
        tenant: ctx.scope.level === 'tenant' ? ctx.scope.tenantId : null,
      };
      const base = {
        scope,
        claims: {},
        roles: testCookieRoles(carrier.headers?.cookie),
        memberships: [],
        via: 'test.cookie',
      };
      const subject = testCookieSubject(carrier.headers?.cookie);
      if (subject === undefined || book.revoked.has(subject)) {
        const anonymous: AnsweredPrincipal = { kind: 'anonymous', ...base, roles: [], ref: null };
        return { principal: anonymous, clearCookies: [testCookieName] };
      }
      const principal: AnsweredPrincipal = {
        kind: 'user',
        subject: subject as never,
        subjectRef: null,
        ...base,
        ref: { resolver: 'test.cookie', principalId: subject },
      };
      return { principal };
    },
  };
}
