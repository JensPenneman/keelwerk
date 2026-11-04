import type { Principal, Scope, UserPrincipal } from '@keelwerk/core';
import type { TestPrincipal } from '../harness/test-principal.ts';

/** The principal a test principal stands for in a scope: a user, or anonymous for a null subject. */
export function drivePrincipal(held: TestPrincipal, scope: Scope): Principal {
  const base = {
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
    claims: held.claims,
    roles: held.roles,
    memberships: [],
    via: 'test.principal',
    ref: null,
  };
  if (held.subject === null) return { kind: 'anonymous', ...base };
  return {
    kind: 'user',
    subject: held.subject as UserPrincipal['subject'],
    subjectRef: null,
    subjectAs: () => null,
    ...base,
  };
}
