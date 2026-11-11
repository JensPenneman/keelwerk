import type { Principal, PrincipalResolver, Scope, UserPrincipal } from '@keelwerk/core';
import type { TestPrincipal } from './test-principal.ts';
import type { TestPrincipalBook } from './test-principal-book.ts';
import { testPrincipalHeader } from './test-principal-header.ts';

function isTestPrincipal(value: unknown): value is TestPrincipal {
  return typeof value === 'object' && value !== null && 'subject' in value && 'roles' in value;
}

/** The principal a test principal stands for in a scope: an operator, a user or the anonymous one. */
function principalOf(held: TestPrincipal, scope: Scope, operators: boolean): Principal {
  const base = {
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
    claims: held.claims,
    roles: held.roles,
    memberships: [],
    via: 'test.principal',
  };
  if (operators && held.claims.operator === true) {
    return {
      kind: 'operator',
      id: held.subject ?? 'operator',
      ...base,
      ref: { resolver: 'test.principal', principalId: held.subject ?? 'operator' },
    };
  }
  if (held.subject === null) return { kind: 'anonymous', ...base, ref: null };
  const user: UserPrincipal = {
    kind: 'user',
    subject: held.subject as UserPrincipal['subject'],
    subjectRef: null,
    subjectAs: () => null,
    ...base,
    ref: { resolver: 'test.principal', principalId: held.subject },
  };
  return user;
}

/**
 * Reads the principal a test carrier holds; a carrier without one is left to the next resolver.
 * The book keeps the principal last seen for each subject, so `fromRef` can rebuild it when a job
 * runs, and answers null for a subject the test revoked.
 */
export function testPrincipalResolver(
  operators = false,
  book: TestPrincipalBook = { seen: new Map(), revoked: new Set() },
): PrincipalResolver {
  return {
    id: 'test.principal',
    describe: () => ({ scheme: 'apiKey', name: testPrincipalHeader }),
    // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
    *resolve(carrier, ctx) {
      const text = carrier.headers?.[testPrincipalHeader];
      if (text === undefined) return null;
      const held: unknown = JSON.parse(text);
      if (!isTestPrincipal(held)) return null;
      if (held.subject !== null) book.seen.set(held.subject, held);
      return { principal: principalOf(held, ctx.scope, operators) };
    },
    // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
    *fromRef(ref, ctx) {
      const held = book.seen.get(ref.principalId);
      if (held === undefined || book.revoked.has(ref.principalId)) return null;
      return { principal: principalOf(held, ctx.scope, operators) };
    },
  };
}
