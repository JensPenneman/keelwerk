import { errors } from '../errors/errors.ts';
import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { coreError } from '../http/core-error.ts';
import { isBrowserRequest } from '../http/is-browser-request.ts';
import { sessionCookie } from '../http/session-cookie.ts';
import type { Span } from '../observability/span.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { Carrier } from './carrier.ts';
import { applyTenantEntry } from './edge/apply-tenant-entry.ts';
import { performResolverEffects } from './edge/perform-resolver-effects.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokerEnv } from './invoker-env.ts';
import { mapUnknownError } from './map-unknown-error.ts';
import type { Outcome } from './outcome.ts';
import { credentialsRefused } from './stages/credentials-refused.ts';
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

/**
 * The carrier without its cookie: under path resolution the transports accept bearer tokens only
 * (16.4.10).
 */
function withoutCookie(carrier: Carrier): Carrier {
  if (carrier.headers?.cookie === undefined) return carrier;
  const { cookie: _cookie, ...headers } = carrier.headers;
  return { ...carrier, headers };
}

async function open(
  env: InvokerEnv,
  carrier: Carrier,
  signal: AbortSignal | undefined,
  requestId: string,
  span: Span,
  standsFor: PrincipalRef | undefined,
  revalidating: boolean,
): Promise<InvocationSession> {
  if (signal?.aborted === true) {
    throw new KeelwerkError({
      kind: 'unavailable',
      code: 'core.unavailable',
      message: 'The request was cancelled.',
    });
  }
  const deployed = await resolveScope(env, carrier);
  const presented = deployed.resolvedBy === 'path' ? withoutCookie(carrier) : carrier;
  const found = await resolvePrincipal(env, presented, deployed, { requestId, span }, standsFor);
  const { expiresAt } = found.principal;
  if (
    expiresAt !== undefined &&
    Temporal.Instant.compare(expiresAt, env.options.clock.now()) <= 0
  ) {
    // A stream ticket answers one error whatever went wrong, so a caller learns nothing of why. A
    // fresh open has proven nothing on this connection, so it gets the refusal of a credential that
    // is not accepted; only the revalidation of a session that was valid when it opened, or a job
    // (whose principal is resolved again when it runs), is told that the session expired.
    if (presented.ticket !== undefined) throw coreError('core.ticket_invalid');
    throw revalidating || carrier.job !== undefined
      ? errors.unauthenticated('The session expired.')
      : credentialsRefused();
  }
  const resolved = await applyTenantEntry(env, presented, deployed, found.principal);
  const version = resolveVersion(env, resolved, presented, found.principal);
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
  const kept = withoutTicket(presented);
  const renew = found.renewCookie;
  const renewed =
    renew !== undefined &&
    resolved.resolvedBy === 'hostname' &&
    isBrowserRequest(carrier.headers ?? {})
      ? [
          sessionCookie(
            renew.name,
            renew.value,
            env.options.clock.now(),
            new Date(renew.expiresAt.epochMilliseconds),
          ),
        ]
      : [];
  const session: InvocationSession = {
    scope: resolved.scope,
    app: resolved.app,
    principal,
    apiVersion: version.apiVersion,
    deprecation: version.deprecation,
    ...(found.clearCookies.length === 0 ? {} : { clearCookies: found.clearCookies }),
    resolvedBy: resolved.resolvedBy,
    ...(resolved.tenantPrefix === undefined ? {} : { tenantPrefix: resolved.tenantPrefix }),
    ...(renewed.length === 0 ? {} : { setCookies: renewed }),
    ...(principal.expiresAt === undefined ? {} : { expiresAt: principal.expiresAt }),
    ...(found.dependsOn === undefined || found.dependsOn.length === 0
      ? {}
      : { dependsOn: found.dependsOn }),
    revalidate: () => reopen(env, kept, {}, reference, true),
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
  revalidating: boolean,
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
      revalidating,
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
 * function creates a session, and it keeps each in the invoker's private registry. A principal
 * whose `expiresAt` is at or before the invoker's clock never gets one: the expiry is compared with
 * the clock once, right after the principal is resolved, so a principal that expires during the
 * rest of the open still gets its session. The open answers `unauthenticated` before the tenant
 * marker, the API version and any effect the resolver asked for; this holds for every path that
 * opens (a transport, an invoke or subscribe without a session, a revalidation, a job). A fresh
 * open gets `credentialsRefused()` ("The credentials were not accepted."), because the caller has
 * proven nothing on this connection; a stream ticket gets `core.ticket_invalid`; the revalidation
 * of a session that was valid at its open, and a job, get "The session expired.". A failure is an
 * outcome: `unauthenticated` passes whatever its code, every other error follows `mapUnknownError`.
 */
export function openSession(
  env: InvokerEnv,
  carrier: Carrier,
  options: { readonly signal?: AbortSignal; readonly requestId?: string } = {},
): Promise<Outcome<InvocationSession>> {
  return reopen(env, carrier, options, undefined, false);
}
