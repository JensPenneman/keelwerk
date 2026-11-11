import { errors } from '../errors/errors.ts';
import type { Logger } from '../observability/logger.ts';
import type { Principal } from '../principals/principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { ClientFlagDocument } from './client-flag-document.ts';
import { flagContextOf } from './flag-context-of.ts';
import type { FlagProvider } from './flag-provider.ts';
import { flagSpecOf } from './flag-spec-of.ts';
import type { FlagTelemetry } from './flag-telemetry.ts';
import { resolveFlag } from './resolve-flag.ts';
import type { TargetingCache } from './targeting-cache.ts';

/**
 * `core.flag.evaluate` (20.3): one flag of the caller's own context. A key no module of `registry`
 * declares and a flag without `client: true` both throw the same `not_found`, with the same text,
 * so the existence of a server-only flag never reaches a caller. Otherwise the providers answer
 * under the targeting context of the flag's level; the answer is counted once, and a provider
 * failure is logged at error level. The document holds the value, variant and reason, never a
 * rule id, a rule version or a provider: operator data stays with operators.
 *
 * A flag is not an access rule: an anonymous caller's targeting key may come from the
 * `Keelwerk-Client-Id` header, which the caller chooses.
 */
export async function evaluateClientFlag(input: {
  readonly registry: Registry;
  readonly key: string;
  readonly scope: Scope;
  readonly principal: Principal;
  readonly clientId: string | null;
  readonly providers: readonly FlagProvider[];
  readonly targeting?: Pick<TargetingCache, 'fresh'> | undefined;
  readonly telemetry?: FlagTelemetry | undefined;
  readonly log: Logger;
}): Promise<ClientFlagDocument> {
  await input.targeting?.fresh();
  const spec = flagSpecOf(input.registry, input.key);
  if (spec === undefined || spec.client !== true) {
    throw errors.not_found(`No client flag is named "${input.key}".`);
  }
  const answer = await resolveFlag(
    input.providers,
    spec,
    flagContextOf(spec.level, {
      scope: input.scope,
      principal: input.principal,
      clientId: input.clientId,
    }),
    (provider, error) => {
      input.log.error('a flag provider failed; the declared default was served', {
        flag: spec.key,
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );
  input.telemetry?.evaluated(spec, answer, input.scope);
  return {
    key: spec.key,
    value: answer.value,
    variant: answer.variant,
    reason: answer.reason,
    ...(answer.errorCode === undefined ? {} : { errorCode: answer.errorCode }),
  };
}
