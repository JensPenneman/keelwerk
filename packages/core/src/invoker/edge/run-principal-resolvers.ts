import type { PrincipalResolution } from '../../edge/principal-resolution.ts';
import type { PrincipalResolver } from '../../edge/principal-resolver.ts';
import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { Clock } from '../../kernel/clock.ts';
import type { Principal } from '../../principals/principal.ts';
import type { AnyEffect } from '../../protocol/any-effect.ts';
import type { Scope } from '../../storage/scope.ts';
import type { Carrier } from '../carrier.ts';
import { placeholderPrincipal } from './placeholder-principal.ts';
import type { ResolverKit } from './resolver-kit.ts';

function isResolver(value: unknown): value is PrincipalResolver {
  return (
    typeof value === 'object' &&
    value !== null &&
    'resolve' in value &&
    typeof value.resolve === 'function'
  );
}

/** Where the principal was resolved (section 8.5), whatever scope the resolver wrote on it. */
function scopeOf(scope: Scope): Principal['scope'] {
  return {
    backend: scope.level === 'deployment' ? null : scope.backendId,
    tenant: scope.level === 'tenant' ? scope.tenantId : null,
  };
}

/** What the resolvers made of a carrier. */
export interface ResolvedPrincipal {
  readonly principal: Principal;
  /** Performed in a short read-write unit right after `open` (S-24). */
  readonly effects: readonly AnyEffect[];
  readonly clearCookies: readonly string[];
  /** The module whose resolver answered; the effects are its (timers fire as its service principal). */
  readonly module?: string;
  /** Whether a resolver accepted credentials; false: the principal is the anonymous placeholder. */
  readonly authenticated: boolean;
}

/**
 * Runs the app's principal resolvers in fill order (section 17.2.4) and takes the first
 * principal that is not anonymous. A resolver that answers null, or an anonymous principal for a
 * stale cookie, passes to the next one, and the cookie names it returns are kept so the host
 * clears them. A resolver that throws, an invalid bearer token for one, fails the open.
 */
export async function runPrincipalResolvers(
  kit: ResolverKit,
  carrier: Carrier,
  scope: Scope,
  clock: Clock,
): Promise<ResolvedPrincipal> {
  const placeholder = placeholderPrincipal(scope);
  const cookies = new Set<string>();
  for (const { module, value } of kit.fills('core.principalResolvers', placeholder)) {
    if (!isResolver(value)) {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `A fill of core.principalResolvers by "${module}" is not a principal resolver.`,
      });
    }
    const resolution = await kit.drive<PrincipalResolution | null>(
      value.resolve(carrier, { scope, clock }),
      module,
      placeholder,
    );
    if (resolution === null) continue;
    for (const name of resolution.clearCookies ?? []) cookies.add(name);
    if (resolution.principal.kind === 'anonymous') continue;
    return {
      principal: { ...resolution.principal, scope: scopeOf(scope) },
      effects: resolution.effects ?? [],
      clearCookies: [...cookies],
      module,
      authenticated: true,
    };
  }
  return { principal: placeholder, effects: [], clearCookies: [...cookies], authenticated: false };
}
