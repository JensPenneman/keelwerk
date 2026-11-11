import { context, propagation } from '@opentelemetry/api';
import { chargeFailureBuckets } from '../admission/charge-failure-buckets.ts';
import type { Admitted } from '../admission/run-admission.ts';
import { translateError } from '../api-versions/translate-error.ts';
import type { VersionTranslation } from '../api-versions/version-translation.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RuleMatch } from '../errors/rule-match.ts';
import { buildSnapshot } from '../flags/build-snapshot.ts';
import { flagClientIdOf } from '../flags/flag-client-id-of.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { InvokerStage } from './decision-hook.ts';
import type { Invocation } from './invocation.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { Invoker } from './invoker.ts';
import type { InvokerEnv } from './invoker-env.ts';
import { createInvokerEnv } from './invoker-env.ts';
import type { InvokerOptions } from './invoker-options.ts';
import type { LiveFrame } from './live-frame.ts';
import { mapUnknownError } from './map-unknown-error.ts';
import { openSession } from './open-session.ts';
import type { Outcome } from './outcome.ts';
import { admit } from './stages/admit.ts';
import { authorize } from './stages/authorize.ts';
import { complete } from './stages/complete.ts';
import { execute } from './stages/execute.ts';
import { locate } from './stages/locate.ts';
import { prepare } from './stages/prepare.ts';
import { relationsAfter } from './stages/relations-after.ts';
import { shape as shapeOutput } from './stages/shape.ts';
import { translate } from './stages/translate.ts';
import { validate } from './stages/validate.ts';

/** The session an invocation runs under: its own when this invoker made it, else a fresh one; a foreign object is `internal`. */
async function sessionOf(
  env: InvokerEnv,
  inv: Invocation<unknown>,
): Promise<Outcome<InvocationSession>> {
  if (inv.session === undefined)
    return openSession(env, inv.carrier, { signal: inv.signal, requestId: inv.requestId });
  if (env.sessions.detailsOf(inv.session) === undefined) {
    return {
      ok: false,
      error: new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: 'The session was not created by this invoker.',
      }),
    };
  }
  return { ok: true, value: inv.session };
}

/** What one invocation leaves behind for the decision hook. */
interface RunState {
  action?: ActionEntry;
  log: Logger;
  admitted?: Admitted;
  stage: InvokerStage;
  rules?: readonly RuleMatch[];
  translation?: VersionTranslation;
}

async function run(
  env: InvokerEnv,
  inv: Invocation<unknown>,
  state: RunState,
  span: Span,
): Promise<Outcome<unknown>> {
  state.stage = 'open';
  const opened = await sessionOf(env, inv);
  if (!opened.ok) return opened;
  const session = opened.value;
  const details = env.sessions.detailsOf(session);
  if (details === undefined) throw new Error('unreachable: the session was just registered');
  const app = env.appOf(details.resolved.app);
  const { registry } = app;
  const translation = env.translationOf(
    app,
    inv.carrier.job === undefined ? session.apiVersion : null,
  );
  state.translation = translation;
  const rules = env.rulesOf(registry);
  const { scope } = session;
  const build = env.options.build ?? { id: 'development', revision: 1 };
  const logOf = (ref: string): Logger =>
    env.options.log.child({
      requestId: inv.requestId,
      action: ref,
      ...(scope.level === 'deployment' ? {} : { backend: scope.backendId }),
      ...(scope.level === 'tenant' ? { tenant: scope.tenantId } : {}),
    });
  state.log = logOf(inv.action);
  span.setAttributes({
    'keelwerk.app': session.app,
    'keelwerk.transport': inv.carrier.transport,
    'keelwerk.api_version': session.apiVersion,
    'keelwerk.build': build.id,
    'keelwerk.build.revision': build.revision,
    ...(scope.level === 'deployment' ? {} : { 'keelwerk.backend': scope.backendId }),
    ...(scope.level === 'tenant' ? { 'keelwerk.tenant': scope.tenantId } : {}),
  });
  state.stage = 'locate';
  const action = locate(registry, inv.action, scope, translation);
  state.action = action;
  const log = logOf(action.ref);
  state.log = log;
  span.setAttributes({
    'keelwerk.action': action.ref,
    'keelwerk.action.requested': inv.action,
    'keelwerk.module': action.module,
    'keelwerk.kind': action.kind,
    'keelwerk.execution': action.execution,
    ...(action.entity === undefined ? {} : { 'keelwerk.entity': action.entity }),
  });
  state.stage = 'admit';
  const flags = await buildSnapshot({
    registry,
    action,
    scope,
    principal: session.principal,
    clientId: flagClientIdOf(inv.carrier),
    providers: env.options.flagProviders ?? [],
    log,
    targeting: env.options.targeting,
    telemetry: env.flagTelemetry,
    span,
  });
  state.admitted = await admit(env, { action, session, details, invocation: inv, span, flags });
  state.stage = 'validate';
  const validated = await validate(action, inv.input, translation);
  state.stage = 'translate';
  const input = await translate(translation, 'input', action, validated);
  state.stage = 'authorize';
  const matched = authorize({
    registry,
    rules,
    action,
    session,
    transport: inv.carrier.job === undefined ? inv.carrier.transport : inv.carrier.job.transport,
    value: input,
    flags,
  });
  state.rules = matched;
  span.setAttribute(
    'keelwerk.rules',
    matched.map((rule) => rule.id),
  );
  state.stage = 'prepare';
  prepare(action);
  state.stage = 'execute';
  const answered = await execute(env, {
    action,
    value: input,
    invocation: inv,
    session,
    details,
    span,
    log,
    flags,
  });
  // An accepted command has no output yet: its receipt is the answer and nothing is shaped.
  state.stage = 'shape';
  let output: unknown;
  if (answered.receipt?.status === 'accepted') {
    output = answered.output;
  } else {
    const shaped = await shapeOutput({
      registry,
      rules,
      action,
      principal: session.principal,
      scope: answered.scope,
      flags,
      outputOf: (one) => env.entityOutputOf(registry, one),
      relations: relationsAfter(registry, action, details),
      environment: env.options.environment,
      output: answered.output,
      ...(answered.replayRef === undefined ? {} : { replayRef: answered.replayRef }),
      onDropped: (dropped) => {
        log.warn('a row outside the read plan was dropped', { ...dropped });
      },
    });
    state.stage = 'translate';
    output = await translate(translation, 'output', action, shaped, validated);
  }
  return {
    ok: true,
    value: output,
    ...(answered.receipt === undefined ? {} : { receipt: answered.receipt }),
    ...(answered.effects === undefined ? {} : { effects: answered.effects }),
    ...(answered.replayed === undefined ? {} : { replayed: answered.replayed }),
    ...(answered.receiptId === undefined || answered.scope.level !== scope.level
      ? {}
      : { receiptId: answered.receiptId }),
  };
}

/**
 * Builds the invoker (section 9.1): `open` runs the session stages once, and `invoke` runs the
 * rest of the pipeline of section 9.2 in order: locate, admit, validate, translate, authorize,
 * prepare, execute, shape, translate, complete. Every stage fails closed into an `Outcome`: a
 * `KeelwerkError` passes when it is a core error or one the action declares, anything else is
 * `internal` and, outside development, redacted. Throws at creation for a tenant resolver the
 * release cannot run (S-20).
 */
export function createInvoker(options: InvokerOptions): Invoker {
  const env = createInvokerEnv(options);
  return {
    open: (carrier, openOptions) => openSession(env, carrier, openOptions),
    invoke: async <I, O>(inv: Invocation<I>): Promise<Outcome<O>> => {
      const parent =
        inv.traceparent === undefined
          ? context.active()
          : propagation.extract(context.active(), { traceparent: inv.traceparent });
      const span = env.tracer.startSpan(
        'keelwerk.invoke',
        { attributes: { 'keelwerk.action': inv.action, 'keelwerk.request': inv.requestId } },
        parent,
      );
      const state: RunState = {
        stage: 'open',
        log: options.log.child({ requestId: inv.requestId, action: inv.action }),
      };
      let outcome: Outcome<unknown>;
      try {
        outcome = await run(env, inv, state, span);
      } catch (error) {
        outcome = {
          ok: false,
          error: mapUnknownError(error, options.environment, state.action?.errors),
        };
      }
      const { admitted } = state;
      if (admitted?.target != null && state.action !== undefined) {
        await chargeFailureBuckets(env, {
          action: state.action,
          target: admitted.target,
          charges: admitted.onDeclaredError,
          outcome,
        });
      }
      const completed = complete({
        span,
        log: state.log,
        action: state.action?.ref ?? inv.action,
        outcome,
      }) as Outcome<O>;
      if (options.onDecision !== undefined) {
        try {
          options.onDecision({
            kind: 'invoke',
            requestId: inv.requestId,
            action: state.action?.ref ?? inv.action,
            transport: inv.carrier.transport,
            stage: completed.ok ? 'complete' : state.stage,
            rules: state.rules ?? (completed.ok ? [] : (completed.error.rules ?? [])),
            ...(completed.ok ? {} : { error: completed.error }),
          });
        } catch (error) {
          state.log.warn('the decision hook failed', { error: String(error) });
        }
      }
      // The log, the span and the decision hook keep the head's action reference and error code; the caller sees the version's.
      return (
        !completed.ok && state.translation !== undefined
          ? { ok: false, error: translateError(state.translation, completed.error, state.action) }
          : completed
      ) as Outcome<O>;
    },
    subscribe: <I, E>(_inv: Invocation<I>): AsyncIterable<LiveFrame<E>> => ({
      // biome-ignore lint/correctness/useYield: live updates are not available in this release
      async *[Symbol.asyncIterator]() {
        throw new KeelwerkError({
          kind: 'unavailable',
          code: 'core.live_unavailable',
          message: 'Live updates are not available in this release.',
        });
      },
    }),
  };
}
