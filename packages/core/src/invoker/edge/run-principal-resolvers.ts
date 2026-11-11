import { cacheDrops } from '../../edge/cache-drops.ts';
import type { CredentialRedemption } from '../../edge/credential-redemption.ts';
import type { PrincipalResolution } from '../../edge/principal-resolution.ts';
import type { PrincipalResolver } from '../../edge/principal-resolver.ts';
import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { Clock } from '../../kernel/clock.ts';
import type { Principal } from '../../principals/principal.ts';
import type { AnyEffect } from '../../protocol/any-effect.ts';
import { moduleResolver } from '../../reactions/module-resolver.ts';
import type { Scope } from '../../storage/scope.ts';
import type { Carrier } from '../carrier.ts';
import { keepsTicketError } from './keeps-ticket-error.ts';
import { placeholderPrincipal } from './placeholder-principal.ts';
import type { ResolverKit } from './resolver-kit.ts';

const kernelResolvers: ReadonlySet<string> = new Set([
  'core.system',
  'core.runtime',
  'core.invoker',
  'core.operator',
  'core.operatorToken',
]);

function isResolver(value: unknown): value is PrincipalResolver {
  return (
    typeof value === 'object' &&
    value !== null &&
    'resolve' in value &&
    typeof value.resolve === 'function'
  );
}

/**
 * What a principal resolver may never answer: the principals only the kernel mints (a module's
 * service principal, the system principal, the runtime and the placeholder), recognised by kind and
 * by the resolver they name (the operator's two included: a user that a stored reference turned into an operator would skip the backend and tenant checks). A resolver's answer is never the object the kernel minted, so none of
 * them is accepted.
 */
function kernelOnlyOf(principal: Principal): string | undefined {
  if (principal.kind === 'system') return 'a system principal';
  for (const resolver of [principal.via, principal.ref?.resolver]) {
    if (resolver === moduleResolver) return "a principal of the kernel's module resolver";
    if (kernelResolvers.has(resolver ?? '')) {
      return `a principal of the kernel's resolver "${resolver}"`;
    }
  }
  return undefined;
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
  /** The rows whose change revalidates the session at once: the rows of the resolution's `cache` (S-151). */
  readonly dependsOn?: readonly { readonly entity: string; readonly id: string }[];
  /** A single-use credential the resolver accepted: `resolvePrincipal` spends it and resolves its reference (S-161); `principal` is then the anonymous placeholder. */
  readonly redeem?: CredentialRedemption;
}

/**
 * Runs the app's principal resolvers in fill order (section 17.2.4) and takes the first
 * principal that is not anonymous. A resolver that answers null, or an anonymous principal for a
 * stale cookie, passes to the next one, and the cookie names it returns are kept so the host
 * clears them. A resolver that throws, an invalid bearer token for one, fails the open; but on a
 * ticket's request a resolver's error of a client kind is dropped (the ticket decides alone), and any
 * other error is thrown only when no resolver redeemed the ticket.
 */
export async function runPrincipalResolvers(
  kit: ResolverKit,
  carrier: Carrier,
  scope: Scope,
  clock: Clock,
): Promise<ResolvedPrincipal> {
  const placeholder = placeholderPrincipal(scope);
  const cookies = new Set<string>();
  let kept: { readonly error: unknown } | undefined;
  for (const { module, value } of kit.fills('core.principalResolvers', placeholder)) {
    if (!isResolver(value)) {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `A fill of core.principalResolvers by "${module}" is not a principal resolver.`,
      });
    }
    let resolution: PrincipalResolution | null;
    try {
      resolution = await kit.drive<PrincipalResolution | null>(
        value.resolve(carrier, { scope, clock }),
        module,
        placeholder,
      );
    } catch (error) {
      if (carrier.ticket === undefined) throw error;
      // Another credential of a ticket's request (a stale API key) never ends the open: the ticket
      // is still redeemed. Only an internal or unavailable error, or a failure that is no keelwerk
      // error, is kept and thrown if nothing redeems; every other error is dropped.
      if (keepsTicketError(error)) kept ??= { error };
      continue;
    }
    if (resolution === null) continue;
    for (const name of resolution.clearCookies ?? []) cookies.add(name);
    if (resolution.redeem !== undefined) {
      const { redeem } = resolution;
      // A redeemed credential stands for a principal of another resolver: never a kernel resolver, and
      // the entity is the answering module's own.
      if (
        kernelResolvers.has(redeem.ref.resolver) ||
        redeem.ref.resolver === moduleResolver ||
        !redeem.entity.startsWith(`${module}.`)
      ) {
        throw new KeelwerkError({
          kind: 'internal',
          code: 'core.internal',
          message: `A fill of core.principalResolvers by "${module}" redeemed a credential for a reference or an entity it may not name.`,
        });
      }
      return {
        principal: placeholder,
        effects: [],
        clearCookies: [...cookies],
        module,
        authenticated: true,
        redeem,
      };
    }
    // A ticket is the one credential of its request and decides alone: what another resolver made of
    // another credential on the same request (an API-key header) is never taken beside it.
    if (carrier.ticket !== undefined) continue;
    if (resolution.principal.kind === 'anonymous') continue;
    const forged = kernelOnlyOf(resolution.principal);
    if (forged !== undefined) {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `A fill of core.principalResolvers by "${module}" answered ${forged}.`,
      });
    }
    return {
      principal: { ...resolution.principal, scope: scopeOf(scope) },
      effects: resolution.effects ?? [],
      clearCookies: [...cookies],
      module,
      authenticated: true,
      ...(resolution.cache === undefined ? {} : { dependsOn: cacheDrops(resolution.cache) }),
    };
  }
  if (kept !== undefined) throw kept.error;
  return { principal: placeholder, effects: [], clearCookies: [...cookies], authenticated: false };
}
