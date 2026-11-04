import type { Principal } from '../../principals/principal.ts';
import type { Scope } from '../../storage/scope.ts';

/** The anonymous principal a resolver's context holds before any principal is resolved. */
export function placeholderPrincipal(scope: Scope): Principal {
  return {
    kind: 'anonymous',
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
    claims: {},
    roles: [],
    memberships: [],
    via: 'core.invoker',
    ref: null,
  };
}
