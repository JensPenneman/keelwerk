import { conditionFields } from '../conditions/condition-fields.ts';
import { sha256 } from '../crypto/sha256.ts';
import { errors } from '../errors/errors.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { LivePokesView } from '../live/live-pokes-view.ts';
import type { Span } from '../observability/span.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { callerView } from '../repositories/caller-view.ts';
import type { Position } from '../storage/position.ts';
import { assertTokenScope } from '../tokens/assert-token-scope.ts';
import { currentTokenCheck } from '../tokens/current-token-check.ts';
import { decodeStateToken } from '../tokens/decode-state-token.ts';
import { encodeStateToken } from '../tokens/encode-state-token.ts';
import { tokenCheckHolds } from '../tokens/token-check-holds.ts';
import { tokenScopePart } from '../tokens/token-scope-part.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokerEnv } from './invoker-env.ts';
import { liveFilterGuard } from './live-filter-guard.ts';
import { liveTokenContextOf } from './live-token-context-of.ts';
import { pokesConcernOf } from './pokes-concern-of.ts';
import { sameSession } from './same-session.ts';
import type { SessionDetails } from './session-details.ts';
import { targetOf } from './stages/target-of.ts';

/**
 * The view of `other` (the same app and scope as `session`, else `internal`) of the pokes of its
 * scope (15.2.5; an `invocation` entity is never in it): one flag snapshot for `action` (the `live.pokes` entry), each entity's plan for
 * the principal through `callerView` with the entity's `watch`, the scope's seal key and the epoch
 * as `createLiveKernel` reads them.
 */
export async function createLivePokesView(
  env: InvokerEnv,
  session: InvocationSession,
  details: SessionDetails,
  action: ActionEntry,
  other: InvocationSession,
  span?: Pick<Span, 'setAttribute'>,
): Promise<LivePokesView> {
  const otherDetails = env.sessions.detailsOf(other);
  if (otherDetails === undefined || !sameSession(other, session)) {
    throw errors.internal('The session is not one this subscription may use.');
  }
  const app = env.appOf(details.resolved.app);
  const { registry } = app;
  const { scope } = targetOf(action, details);
  if (scope.level === 'deployment') {
    throw errors.unsupported('The pokes of a deployment-level scope cannot be followed.');
  }
  const log = env.options.log.child({
    backend: scope.backendId,
    ...(scope.level === 'tenant' ? { tenant: scope.tenantId } : {}),
  });
  const rules = env.rulesOf(registry);
  const epoch = env.options.epochOf === undefined ? 0 : env.options.epochOf(scope);
  const { flags, tokens } = await liveTokenContextOf({
    env,
    registry,
    rules,
    action,
    other,
    otherDetails,
    scope,
    epoch,
    log,
    span,
  });
  const context = principalContextOf(registry, other.principal, scope, flags);
  const own = scope.level === 'tenant' ? 'tenant' : 'backend';
  const checks = new Map<string, string>();
  const concerned = new Map<string, ReturnType<typeof pokesConcernOf>>();
  for (const entry of [...registry.entities.values()].sort((a, b) => a.ref.localeCompare(b.ref))) {
    if (entry.descriptor.tenancy !== own) continue;
    // A type no caller can watch (`generated: { watch: false }`) is never named: no state token of it is accepted.
    const watch = registry.actions.get(`${entry.ref}.watch`);
    if (watch === undefined) continue;
    const { plan } = callerView({ entry, rules, action: watch, context });
    if (plan.kind === 'never') continue;
    checks.set(entry.ref, currentTokenCheck(tokens, entry.ref, scope));
    // A plan that reads rows of another entity cannot be decided from the batch: such a type is named for every change.
    if (plan.kind === 'conditional' && conditionFields(plan.where).quantifiers.length === 0) {
      concerned.set(
        entry.ref,
        pokesConcernOf(liveFilterGuard(registry, entry), entry.descriptor, plan.where),
      );
    }
  }
  const key = sha256(canonicalizeJson([...checks.entries()]));
  const pokesCheck = sha256(canonicalizeJson({ pokes: key, apiVersion: other.apiVersion })).slice(
    0,
    8,
  );
  const scopePart = tokenScopePart(scope);
  return {
    key,
    entities: new Set(checks.keys()),
    conditional: new Set(concerned.keys()),
    concerns: (entity, changes) => concerned.get(entity)?.(changes) ?? true,
    stateToken: (entity: string, position: Position) => {
      const check = checks.get(entity);
      if (check === undefined) {
        throw errors.internal(`"${entity}" is not an entity type of these pokes.`);
      }
      return encodeStateToken({ epoch, position, scope: scopePart, check }, tokens.sealKey);
    },
    token: (position: Position) =>
      encodeStateToken({ epoch, position, scope: scopePart, check: pokesCheck }, tokens.sealKey),
    judge: (token: string, head: Position) => {
      const parts = decodeStateToken(token);
      assertTokenScope(parts, scope);
      if (parts.epoch !== epoch) return 'resync';
      if (!tokenCheckHolds(parts, pokesCheck, tokens.sealKey)) return 'resync';
      return parts.position > head ? 'resync' : parts.position;
    },
  };
}
