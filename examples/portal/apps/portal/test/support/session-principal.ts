import type { Principal, Scope, UserPrincipal } from '@keelwerk/core';

/** The principal a bearer session resolves to: a user whose credential reference names the session (17.2.3). */
export function sessionPrincipal(scope: Scope, subject: string, sessionId: string): Principal {
  const ref = { resolver: 'auth.session', principalId: sessionId, sessionId };
  return {
    kind: 'user',
    subject: subject as UserPrincipal['subject'],
    subjectRef: null,
    subjectAs: () => null,
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
    claims: {},
    roles: [],
    memberships: [],
    via: 'auth.session',
    ref,
  };
}
