import { mintedServiceModules } from '../principals/minted-service-modules.ts';
import type { Principal } from '../principals/principal.ts';
import type { ServicePrincipal } from '../principals/service-principal.ts';
import { moduleResolver } from './module-resolver.ts';

/**
 * The service principal `<module>.system` a module's reactions and timers act as (section 7.7):
 * never the principal that caused the event. It carries no roles or claims, so it can do what the
 * core's default rule gives it (the actions of its own module) and whatever a rule grants a
 * `service` principal. It lives in the scope of the work it acts on. The object is frozen and
 * recorded as minted for `module`: that identity, not its id or reference, is what the default rule
 * recognises, so a copy of it has no module.
 */
export function moduleServicePrincipal(
  module: string,
  caused: Pick<Principal, 'scope'>,
): ServicePrincipal {
  const id = `${module}.system`;
  const principal: ServicePrincipal = {
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
  Object.freeze(principal);
  mintedServiceModules.set(principal, module);
  return principal;
}
