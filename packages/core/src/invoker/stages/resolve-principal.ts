import { retiredPinTarget } from '../../api-versions/retired-pin-target.ts';
import { utcDayOf } from '../../api-versions/utc-day-of.ts';
import { errors } from '../../errors/errors.ts';
import { isKeelwerkError } from '../../errors/is-keelwerk-error.ts';
import { coreError } from '../../http/core-error.ts';
import type { Span } from '../../observability/span.ts';
import type { PrincipalRef } from '../../principals/principal-ref.ts';
import { reresolvePrincipal } from '../../worker/reresolve-principal.ts';
import { resolvePrincipalRef } from '../../worker/resolve-principal-ref.ts';
import type { Carrier } from '../carrier.ts';
import { atOperatorHost } from '../edge/at-operator-host.ts';
import { keepsTicketError } from '../edge/keeps-ticket-error.ts';
import { operatorResolver } from '../edge/operator-resolver.ts';
import { operatorTokenOf } from '../edge/operator-token-of.ts';
import { placeholderPrincipal } from '../edge/placeholder-principal.ts';
import { runPrincipalEnrichers } from '../edge/run-principal-enrichers.ts';
import type { ResolvedPrincipal } from '../edge/run-principal-resolvers.ts';
import { runPrincipalResolvers } from '../edge/run-principal-resolvers.ts';
import { spendCredential } from '../edge/spend-credential.ts';
import { withResolverKit } from '../edge/with-resolver-kit.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import { moduleConfigOf } from '../module-config-of.ts';
import type { ResolvedScope } from '../resolved-scope.ts';

function bearerPresent(carrier: Carrier): boolean {
  return (
    carrier.token !== undefined ||
    (carrier.headers?.authorization ?? '').toLowerCase().startsWith('bearer ')
  );
}

/**
 * `resolvePrincipal` (section 9.2): a worker's carrier re-resolves the job's principal reference
 * (S-122); the operator's local carrier is an operator, and so is the holder of an accepted operator token (section 3.5); any other
 * carrier runs the app's principal resolvers and enrichers in one read-only unit of the resolved
 * scope (S-24). No credentials, or a cookie session that is unknown, give the anonymous
 * principal with the cookies to clear. A ticket that no resolver redeems fails with
 * `core.ticket_invalid`, so a broken ticket never opens a request as another credential or as nobody. A bearer credential that no resolver accepts fails with
 * `unauthenticated`, so a broken token never downgrades silently (section 16.3.4). A resolver that
 * redeems a single-use credential (a stream ticket, S-161) has it spent, then the principal its
 * reference names resolved as a job's is; `standsFor` names such a reference up front and skips the
 * carrier, for the revalidation of a session that a credential opened.
 */
export async function resolvePrincipal(
  env: InvokerEnv,
  carrier: Carrier,
  resolved: ResolvedScope,
  context: { readonly requestId: string; readonly span: Span },
  standsFor?: PrincipalRef,
): Promise<ResolvedPrincipal> {
  if (standsFor !== undefined) {
    // A session a credential opened that no longer resolves says so about the session, not about a job.
    return resolvePrincipalRef(env, standsFor, resolved, context, carrier.transport).catch(
      (error: unknown) => {
        throw isKeelwerkError(error) && error.kind === 'unauthenticated'
          ? errors.unauthenticated('The principal of this session no longer resolves.')
          : error;
      },
    );
  }
  if (carrier.job !== undefined) return reresolvePrincipal(env, carrier.job, resolved, context);
  const operator = operatorResolver(carrier);
  if (operator !== undefined) {
    return { principal: operator, effects: [], clearCookies: [], authenticated: true };
  }
  const presented = operatorTokenOf(carrier);
  if (
    presented !== undefined &&
    env.options.operatorTokens !== undefined &&
    atOperatorHost(env, carrier)
  ) {
    return {
      principal: await env.options.operatorTokens(presented),
      effects: [],
      clearCookies: [],
      authenticated: true,
    };
  }
  // An operator token is no credential of the app: away from an operator host it ends here, so the
  // app's resolvers never see it.
  if (presented !== undefined) throw errors.unauthenticated('The credentials were not accepted.');
  const { target } = resolved;
  if (target === null) {
    // A ticket that nothing can redeem is refused: it never opens an anonymous request.
    if (carrier.ticket !== undefined) throw coreError('core.ticket_invalid');
    return {
      principal: placeholderPrincipal(resolved.scope),
      effects: [],
      clearCookies: [],
      authenticated: false,
    };
  }
  const { registry, configShapes, api } = env.appOf(resolved.app);
  const today = (): string => utcDayOf(env.options.clock.now());
  const result = await withResolverKit(
    {
      env,
      registry,
      target,
      backendTarget: resolved.backendTarget,
      config: moduleConfigOf(configShapes, resolved.backendConfig),
      transport: carrier.transport,
      requestId: context.requestId,
      span: context.span,
    },
    async (kit) => {
      const found = await runPrincipalResolvers(
        kit,
        carrier,
        resolved.scope,
        env.options.clock,
        api === undefined ? undefined : (pin) => retiredPinTarget(api, pin, today()),
      );
      // A redeemed credential stands for the principal its reference names, which is enriched after it is resolved.
      if (found.redeem !== undefined) return found;
      return { ...found, principal: await runPrincipalEnrichers(kit, found.principal) };
    },
  );
  // A ticket is the one credential of its request: no resolver that redeems it means it is broken
  // (or another resolver took the request), and it never downgrades to another credential or to anonymous.
  if (carrier.ticket !== undefined && result.redeem === undefined) {
    throw coreError('core.ticket_invalid');
  }
  if (!result.authenticated && bearerPresent(carrier)) {
    throw errors.unauthenticated('The credentials were not accepted.');
  }
  if (result.redeem !== undefined) {
    await spendCredential(env, target, resolved.app, result.redeem);
    // A spend-only ticket was presented where it may not be: it is spent and never yields a session.
    if (carrier.ticket?.spendOnly === true) throw coreError('core.ticket_invalid');
    // A ticket whose principal no longer resolves (any error but an internal or unavailable one, or a
    // reference that answers nothing) answers what a spent, expired or unknown ticket answers; an
    // internal or unavailable error, or a failure that is no keelwerk error, stays what it is.
    const standing = await resolvePrincipalRef(
      env,
      result.redeem.ref,
      resolved,
      context,
      carrier.transport,
    ).catch((error: unknown) => {
      throw keepsTicketError(error) ? error : coreError('core.ticket_invalid');
    });
    return {
      ...standing,
      clearCookies: result.clearCookies,
      ...(result.module === undefined ? {} : { module: result.module }),
      redeem: result.redeem,
    };
  }
  return result;
}
