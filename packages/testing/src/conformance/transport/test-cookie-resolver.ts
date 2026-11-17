import type { Principal, PrincipalResolver } from '@keelwerk/core';
import { cookieValueOf } from './cookie-value-of.ts';
import { testCookieName } from './test-cookie-name.ts';

/**
 * The test session cookie until the auth module's resolver lands: `__Host-kw-test=user:<subject>`
 * is that user; any other value is a stale session, answered as anonymous with the cookie cleared
 * (16.3.4), so a public action still works and the browser forgets the cookie.
 */
export function testCookieResolver(): PrincipalResolver {
  return {
    id: 'test.cookie',
    describe: () => ({ scheme: 'cookie', name: testCookieName }),
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
        roles: [],
        memberships: [],
        via: 'test.cookie',
      };
      if (!held.startsWith('user:')) {
        const anonymous: Principal = { kind: 'anonymous', ...base, ref: null };
        return { principal: anonymous, clearCookies: [testCookieName] };
      }
      const principal: Principal = {
        kind: 'user',
        subject: held.slice('user:'.length) as never,
        subjectRef: null,
        subjectAs: () => null,
        ...base,
        ref: { resolver: 'test.cookie', principalId: held.slice('user:'.length) },
      };
      return { principal };
    },
  };
}
