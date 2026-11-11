import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Span } from '../observability/span.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { Carrier } from './carrier.ts';
import { applyTenantEntry } from './edge/apply-tenant-entry.ts';
import { performResolverEffects } from './edge/perform-resolver-effects.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokerEnv } from './invoker-env.ts';
import { mapUnknownError } from './map-unknown-error.ts';
import type { Outcome } from './outcome.ts';
import { resolvePrincipal } from './stages/resolve-principal.ts';
import { resolveScope } from './stages/resolve-scope.ts';
import { resolveVersion } from './stages/resolve-version.ts';

/** The carrier a session keeps for its revalidation: a ticket is spent, so it is never kept. */
function withoutTicket(carrier: Carrier): Carrier {
  if (carrier.ticket === undefined) return carrier;
  const kept: { -readonly [Name in keyof Carrier]: Carrier[Name] } = { ...carrier };
  delete kept.ticket;
  return kept;
}

async function open(
  env: InvokerEnv,
  carrier: Carrier,
  signal: AbortSignal | undefined,
  requestId: string,
  span: Span,
  standsFor: PrincipalRef | undefined,
): Promise<InvocationSession> {
  if (signal?.aborted === true) {
    throw new KeelwerkError({
      kind: 'unavailable',
      code: 'core.unavailable',
      message: 'The request was cancelled.',
    });
  }
  const deployed = await resolveScope(env, carrier);
  const found = await resolvePrincipal(env, carrier, deployed, { requestId, span }, standsFor);
  const resolved = await applyTenantEntry(env, carrier, deployed, found.principal);
  const version = resolveVersion(env, resolved, carrier, found.principal);
  if (resolved.target !== null) {
    await performResolverEffects(
      env,
      resolved.target,
      found.principal,
      found.effects,
      found.module,
    );
  }
  const { principal } = found;
  // A session that a redeemed credential opened is revalidated by the reference it stands for, never by the spent credential.
  const reference = found.redeem?.ref ?? standsFor;
  const kept = withoutTicket(carrier);
  const session: InvocationSession = {
    scope: resolved.scope,
    app: resolved.app,
    principal,
    apiVersion: version.apiVersion,
    deprecation: version.deprecation,
    ...(found.clearCookies.length === 0 ? {} : { clearCookies: found.clearCookies }),
    resolvedBy: resolved.resolvedBy,
    ...(principal.expiresAt === undefined ? {} : { expiresAt: principal.expiresAt }),
    ...(found.dependsOn === undefined || found.dependsOn.length === 0
      ? {}
      : { dependsOn: found.dependsOn }),
    revalidate: () => reopen(env, kept, {}, reference),
  };
  env.sessions.register(session, { resolved, carrier: kept });
  return session;
}

/** What `openSession` and the revalidation of a session share; `standsFor` is the reference of a redeemed credential. */
async function reopen(
  env: InvokerEnv,
  carrier: Carrier,
  options: { readonly signal?: AbortSignal; readonly requestId?: string },
  standsFor: PrincipalRef | undefined,
): Promise<Outcome<InvocationSession>> {
  const span = env.tracer.startSpan('keelwerk.open', {
    attributes: { 'keelwerk.transport': carrier.transport },
  });
  try {
    const session = await open(
      env,
      carrier,
      options.signal,
      options.requestId ?? globalThis.crypto.randomUUID(),
      span,
      standsFor,
    );
    return { ok: true, value: session };
  } catch (error) {
    const mapped =
      isKeelwerkError(error) && error.kind === 'unauthenticated'
        ? error
        : mapUnknownError(error, env.options.environment);
    if (mapped.kind === 'internal') env.options.log.error(mapped.message, { cause: mapped.cause });
    return { ok: false, error: mapped };
  } finally {
    span.end();
  }
}

/**
 * `Invoker.open` (section 16.3.4): `resolveScope`, `resolvePrincipal` and `resolveVersion` once
 * for a transport request or a connection, then the effects a resolver returned. Only this
 * function creates a session, and it keeps each in the invoker's private registry. A failure is
 * an outcome: `unauthenticated` passes whatever its code, every other error follows
 * `mapUnknownError`.
 */
export function openSession(
  env: InvokerEnv,
  carrier: Carrier,
  options: { readonly signal?: AbortSignal; readonly requestId?: string } = {},
): Promise<Outcome<InvocationSession>> {
  return reopen(env, carrier, options, undefined);
}
