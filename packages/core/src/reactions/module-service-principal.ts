import type { Principal } from '../principals/principal.ts';
import type { ServicePrincipal } from '../principals/service-principal.ts';
import { moduleResolver } from './module-resolver.ts';

/**
 * The service principal `<module>.system` a module's reactions and timers act as (section 7.7):
 * never the principal that caused the event. It carries no roles or claims, so it can do what the
 * core's default rule gives it (the actions of its own module) and whatever a rule grants a
 * `service` principal. It lives in the scope of the work it acts on.
 */
export function moduleServicePrincipal(module: string, caused: Principal): ServicePrincipal {
  const id = `${module}.system`;
  return {
    kind: 'service',
    id,
    idAs: () => null,
    scope: caused.scope,
    claims: {},
    roles: [],
    memberships: [],
    via: moduleResolver,
    ref: { resolver: moduleResolver, principalId: id },
  };
}
