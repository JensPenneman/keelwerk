import { context, propagation } from '@opentelemetry/api';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
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

async function run(
  env: InvokerEnv,
  inv: Invocation<unknown>,
  state: { action?: ActionEntry; log: Logger },
  span: Span,
): Promise<Outcome<unknown>> {
  const opened = await sessionOf(env, inv);
  if (!opened.ok) return opened;
  const session = opened.value;
  const details = env.sessions.detailsOf(session);
  if (details === undefined) throw new Error('unreachable: the session was just registered');
  const { registry } = env.appOf(details.resolved.app);
  const rules = env.rulesOf(registry);
  const { scope } = session;
  const build = env.options.build ?? { id: 'development', revision: 1 };
  const log = env.options.log.child({
    requestId: inv.requestId,
    action: inv.action,
    ...(scope.level === 'deployment' ? {} : { backend: scope.backendId }),
    ...(scope.level === 'tenant' ? { tenant: scope.tenantId } : {}),
  });
  state.log = log;
  span.setAttributes({
    'keelwerk.app': session.app,
    'keelwerk.transport': inv.carrier.transport,
    'keelwerk.api_version': session.apiVersion,
    'keelwerk.build': build.id,
    'keelwerk.build.revision': build.revision,
    ...(scope.level === 'deployment' ? {} : { 'keelwerk.backend': scope.backendId }),
    ...(scope.level === 'tenant' ? { 'keelwerk.tenant': scope.tenantId } : {}),
  });
  const action = locate(registry, inv.action, scope);
  state.action = action;
  span.setAttributes({
    'keelwerk.module': action.module,
    'keelwerk.kind': action.kind,
    'keelwerk.execution': action.execution,
    ...(action.entity === undefined ? {} : { 'keelwerk.entity': action.entity }),
  });
  admit(action, session);
  const validated = await validate(action, inv.input);
  const input = translate('input', validated);
  const matched = authorize({
    registry,
    rules,
    action,
    session,
    transport: inv.carrier.transport,
    value: input,
  });
  span.setAttribute(
    'keelwerk.rules',
    matched.map((rule) => rule.id),
  );
  prepare(action);
  const answered = await execute(env, {
    action,
    value: input,
    invocation: inv,
    session,
    details,
    span,
    log,
  });
  // An accepted command has no output yet: its receipt is the answer and nothing is shaped.
  const output =
    answered.receipt?.status === 'accepted'
      ? answered.output
      : await shapeOutput({
          registry,
          rules,
          action,
          principal: session.principal,
          scope: answered.scope,
          outputOf: (one) => env.entityOutputOf(registry, one),
          environment: env.options.environment,
          output: translate('output', answered.output),
          onDropped: (dropped) => {
            log.warn('a row outside the read plan was dropped', { ...dropped });
          },
        });
  return {
    ok: true,
    value: output,
    ...(answered.receipt === undefined ? {} : { receipt: answered.receipt }),
    ...(answered.effects === undefined ? {} : { effects: answered.effects }),
    ...(answered.replayed === undefined ? {} : { replayed: answered.replayed }),
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
      const state: { action?: ActionEntry; log: Logger } = {
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
      return complete({
        span,
        log: state.log,
        action: inv.action,
        outcome,
      }) as Outcome<O>;
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
