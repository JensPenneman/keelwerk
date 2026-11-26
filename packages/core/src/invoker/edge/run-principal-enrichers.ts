import type { PrincipalEnricher } from '../../edge/principal-enricher.ts';
import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { Membership } from '../../principals/membership.ts';
import type { Principal } from '../../principals/principal.ts';
import { keepOwnMemberships } from './keep-own-memberships.ts';
import type { ResolverKit } from './resolver-kit.ts';

function isEnricher(value: unknown): value is PrincipalEnricher {
  return (
    typeof value === 'object' &&
    value !== null &&
    'enrich' in value &&
    typeof value.enrich === 'function'
  );
}

/**
 * Adds the roles and memberships the app's principal enrichers return, once per session
 * (section 8.5). Users and services are enriched; anonymous, operator and system principals are
 * returned as they are. A membership's kind starts with the id of the module whose enricher
 * returns it, followed by a dot: another module's kind is refused as `internal`, because a module's
 * authorization helpers trust its own kinds; a principal resolver is held to the same rule.
 * Roles are a convenience and stay unchecked.
 */
export async function runPrincipalEnrichers(
  kit: ResolverKit,
  principal: Principal,
): Promise<Principal> {
  if (principal.kind !== 'user' && principal.kind !== 'service') return principal;
  const roles = new Set(principal.roles);
  const memberships: Membership[] = [...principal.memberships];
  for (const { module, value } of kit.fills('core.principalEnrichers', principal)) {
    if (!isEnricher(value)) {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `A fill of core.principalEnrichers by "${module}" is not a principal enricher.`,
      });
    }
    const added = await kit.drive<{
      readonly roles?: readonly string[];
      readonly memberships?: readonly Membership[];
    }>(value.enrich(principal), module, principal);
    for (const role of added.roles ?? []) roles.add(role);
    memberships.push(
      ...keepOwnMemberships('core.principalEnrichers', module, added.memberships ?? []),
    );
  }
  return { ...principal, roles: [...roles], memberships };
}
