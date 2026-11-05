import type { Principal, PrincipalResolver, UserPrincipal } from '@keelwerk/core';
import type { TestPrincipal } from './test-principal.ts';
import { testPrincipalHeader } from './test-principal-header.ts';

function isTestPrincipal(value: unknown): value is TestPrincipal {
  return typeof value === 'object' && value !== null && 'subject' in value && 'roles' in value;
}

/** Reads the principal a test carrier holds; a carrier without one is left to the next resolver. */
export function testPrincipalResolver(operators = false): PrincipalResolver {
  return {
    id: 'test.principal',
    describe: () => ({ scheme: 'apiKey', name: testPrincipalHeader }),
    *resolve(carrier, ctx) {
      const text = carrier.headers?.[testPrincipalHeader];
      if (text === undefined) return null;
      const held: unknown = JSON.parse(text);
      if (!isTestPrincipal(held)) return null;
      const scope = {
        backend: ctx.scope.level === 'deployment' ? null : ctx.scope.backendId,
        tenant: ctx.scope.level === 'tenant' ? ctx.scope.tenantId : null,
      };
      const base = {
        scope,
        claims: held.claims,
        roles: held.roles,
        memberships: [],
        via: 'test.principal',
      };
      const principal: Principal =
        operators && held.claims.operator === true
          ? {
              kind: 'operator',
              id: held.subject ?? 'operator',
              ...base,
              ref: { resolver: 'test.principal', principalId: held.subject ?? 'operator' },
            }
          : held.subject === null
            ? { kind: 'anonymous', ...base, ref: null }
            : {
                kind: 'user',
                subject: held.subject as UserPrincipal['subject'],
                subjectRef: null,
                subjectAs: () => null,
                ...base,
                ref: { resolver: 'test.principal', principalId: held.subject },
              };
      return { principal };
    },
  };
}
