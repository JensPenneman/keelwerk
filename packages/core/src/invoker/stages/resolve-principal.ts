import { errors } from '../../errors/errors.ts';
import type { Span } from '../../observability/span.ts';
import { reresolvePrincipal } from '../../worker/reresolve-principal.ts';
import type { Carrier } from '../carrier.ts';
import { atOperatorHost } from '../edge/at-operator-host.ts';
import { operatorResolver } from '../edge/operator-resolver.ts';
import { operatorTokenOf } from '../edge/operator-token-of.ts';
import { placeholderPrincipal } from '../edge/placeholder-principal.ts';
import { runPrincipalEnrichers } from '../edge/run-principal-enrichers.ts';
import type { ResolvedPrincipal } from '../edge/run-principal-resolvers.ts';
import { runPrincipalResolvers } from '../edge/run-principal-resolvers.ts';
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
 * principal with the cookies to clear. A bearer credential that no resolver accepts fails with
 * `unauthenticated`, so a broken token never downgrades silently (section 16.3.4).
 */
export async function resolvePrincipal(
  env: InvokerEnv,
  carrier: Carrier,
  resolved: ResolvedScope,
  context: { readonly requestId: string; readonly span: Span },
): Promise<ResolvedPrincipal> {
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
    return {
      principal: placeholderPrincipal(resolved.scope),
      effects: [],
      clearCookies: [],
      authenticated: false,
    };
  }
  const { registry, configShapes } = env.appOf(resolved.app);
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
      const found = await runPrincipalResolvers(kit, carrier, resolved.scope, env.options.clock);
      return { ...found, principal: await runPrincipalEnrichers(kit, found.principal) };
    },
  );
  if (!result.authenticated && bearerPresent(carrier)) {
    throw errors.unauthenticated('The credentials were not accepted.');
  }
  return result;
}
