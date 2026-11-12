import { buildSnapshot } from '../flags/build-snapshot.ts';
import { flagClientIdOf } from '../flags/flag-client-id-of.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { StateTokenContext } from '../tokens/state-token-context.ts';
import { stateTokenKey } from '../tokens/state-token-key.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokerEnv } from './invoker-env.ts';
import type { SessionDetails } from './session-details.ts';

/**
 * The flag snapshot of `other` for `action` and the context its state tokens are made and checked
 * in: the scope's seal key and epoch, and the snapshot. A live kernel and the pokes view of a
 * session both start from it.
 */
export async function liveTokenContextOf(input: {
  readonly env: InvokerEnv;
  readonly registry: Registry;
  readonly rules: StateTokenContext['rules'];
  readonly action: ActionEntry;
  readonly other: InvocationSession;
  readonly otherDetails: SessionDetails;
  /** The scope of the target: the seal key is the scope's. */
  readonly scope: Scope;
  readonly epoch: number;
  readonly log: Logger;
  readonly span: Pick<Span, 'setAttribute'> | undefined;
}): Promise<{ readonly flags: FlagSnapshot; readonly tokens: StateTokenContext }> {
  const { env, other } = input;
  const flags = await buildSnapshot({
    registry: input.registry,
    action: input.action,
    scope: other.scope,
    principal: other.principal,
    clientId: flagClientIdOf(input.otherDetails.carrier),
    providers: env.options.flagProviders ?? [],
    log: input.log,
    targeting: env.options.targeting,
    telemetry: env.flagTelemetry,
    span: input.span,
  });
  const tokens: StateTokenContext = {
    registry: input.registry,
    rules: input.rules,
    principal: other.principal,
    epoch: input.epoch,
    sealKey: await stateTokenKey(env.options.keys, input.scope),
    flags,
  };
  return { flags, tokens };
}
