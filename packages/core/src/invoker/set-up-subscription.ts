import { context, propagation } from '@opentelemetry/api';
import { translateError } from '../api-versions/translate-error.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StateToken } from '../events/state-token.ts';
import { buildSnapshot } from '../flags/build-snapshot.ts';
import { flagClientIdOf } from '../flags/flag-client-id-of.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import type { RequestAuthorities } from '../interpreter/request-authorities.ts';
import type { LiveKernel } from '../live/live-kernel.ts';
import { liveKernelFactories } from '../live/live-kernel-factories.ts';
import { liveKernelOf } from '../live/live-kernel-of.ts';
import type { LivePokesPlan } from '../live/live-pokes-plan.ts';
import type { LiveSourcePlan } from '../live/live-source-plan.ts';
import { planLiveSource } from '../live/plan-live-source.ts';
import { runLiveSource } from '../live/run-live-source.ts';
import type { WatchInput } from '../live/watch-input.ts';
import type { Logger } from '../observability/logger.ts';
import type { Principal } from '../principals/principal.ts';
import { assertTokenScope } from '../tokens/assert-token-scope.ts';
import { decodeStateToken } from '../tokens/decode-state-token.ts';
import { bindSubscriptionSession } from './bind-subscription-session.ts';
import { createLiveKernel } from './create-live-kernel.ts';
import type { Invocation } from './invocation.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokerEnv } from './invoker-env.ts';
import { liveMapDriverOf } from './live-map-driver-of.ts';
import { mapUnknownError } from './map-unknown-error.ts';
import { moduleConfigOf } from './module-config-of.ts';
import type { OpenedSubscription } from './opened-subscription.ts';
import type { Outcome } from './outcome.ts';
import { registerPokesView } from './register-pokes-view.ts';
import { requestInfoOf } from './request-info-of.ts';
import { sessionOf } from './session-of.ts';
import { sourceContextOf } from './source-context-of.ts';
import { admit } from './stages/admit.ts';
import { authorize } from './stages/authorize.ts';
import { complete } from './stages/complete.ts';
import { locate } from './stages/locate.ts';
import { targetOf } from './stages/target-of.ts';
import { translate } from './stages/translate.ts';
import { validate } from './stages/validate.ts';
import type { SubscriptionSetupState } from './subscription-setup-state.ts';

function liveUnavailable(): KeelwerkError {
  return new KeelwerkError({
    kind: 'unavailable',
    code: 'core.live_unavailable',
    message: 'Live updates are not available in this release.',
  });
}

/**
 * The setup of a subscription up to its decision (9.2): the stages in order, then the source plan
 * and the kernel's view of it. Everything thrown on the way carries the stage it was thrown at, and
 * the decision hook hears of it once, at the end.
 */
export async function setUpSubscription(
  env: InvokerEnv,
  inv: Invocation<unknown>,
  resume: { readonly after: StateToken } | undefined,
  state: SubscriptionSetupState,
): Promise<OpenedSubscription> {
  const span = env.tracer.startSpan(
    'keelwerk.subscribe',
    { attributes: { 'keelwerk.action': inv.action, 'keelwerk.request': inv.requestId } },
    inv.traceparent === undefined
      ? context.active()
      : propagation.extract(context.active(), { traceparent: inv.traceparent }),
  );
  let outcome: Outcome<undefined> = { ok: true, value: undefined };
  try {
    state.stage = 'open';
    const opened = await sessionOf(env, inv);
    if (!opened.ok) throw opened.error;
    const session: InvocationSession = opened.value;
    const details = env.sessions.detailsOf(session);
    if (details === undefined) throw errors.internal('The session was just registered.');
    const app = env.appOf(details.resolved.app);
    const { registry } = app;
    const translation = env.translationOf(app, session.apiVersion);
    state.translation = translation;
    const rules = env.rulesOf(registry);
    const { scope } = session;
    const logOf = (ref: string): Logger =>
      env.options.log.child({
        requestId: inv.requestId,
        action: ref,
        ...(scope.level === 'deployment' ? {} : { backend: scope.backendId }),
        ...(scope.level === 'tenant' ? { tenant: scope.tenantId } : {}),
      });
    state.log = logOf(inv.action);
    state.stage = 'locate';
    const action = locate(registry, inv.action, scope, translation);
    state.action = action;
    const log = logOf(action.ref);
    state.log = log;
    span.setAttributes({
      'keelwerk.app': session.app,
      'keelwerk.transport': inv.carrier.transport,
      'keelwerk.api_version': session.apiVersion,
      'keelwerk.action': action.ref,
      'keelwerk.kind': action.kind,
    });
    if (action.kind !== 'subscription') {
      throw errors.unsupported(`"${action.ref}" is not a subscription.`);
    }
    if (scope.level === 'deployment') {
      throw errors.unsupported('A subscription at the deployment level is not available yet.');
    }
    // The two facts of the carrier the stream keeps, read once: the regate below must not hold the carrier itself for the life of the stream.
    const clientId = flagClientIdOf(inv.carrier);
    const { transport } = inv.carrier;
    state.stage = 'admit';
    const flags = await buildSnapshot({
      registry,
      action,
      scope,
      principal: session.principal,
      clientId,
      providers: env.options.flagProviders ?? [],
      log,
      targeting: env.options.targeting,
      telemetry: env.flagTelemetry,
      span,
    });
    await admit(env, { action, session, details, invocation: inv, span, flags });
    state.stage = 'validate';
    const validated = await validate(action, inv.input, translation);
    state.stage = 'translate';
    const input = await translate(translation, 'input', action, validated);
    state.stage = 'authorize';
    state.rules = authorize({
      registry,
      rules,
      action,
      session,
      transport: inv.carrier.transport,
      value: input,
      flags,
    });
    // Who the generator maps load for: the hub's renewal replaces it (below), so every item's loads run with the principal and flags of the last renewal.
    let subject: { readonly principal: Principal; readonly flags: FlagSnapshot } = {
      principal: session.principal,
      flags,
    };
    // The hub revalidates the stream with this session: it reopens the session and decides the
    // subscription's own gate again (flag gates, rules, the action's principal list) over the same input.
    const bound = bindSubscriptionSession(env, session, async (fresh) => {
      const regated = await buildSnapshot({
        registry,
        action,
        scope: fresh.scope,
        principal: fresh.principal,
        clientId,
        providers: env.options.flagProviders ?? [],
        log,
        targeting: env.options.targeting,
        telemetry: env.flagTelemetry,
      });
      authorize({
        registry,
        rules,
        action,
        session: fresh,
        transport,
        value: input,
        flags: regated,
      });
      subject = { principal: fresh.principal, flags: regated };
    });
    state.stage = 'execute';
    const hub = app.liveHub;
    if (hub === undefined) throw liveUnavailable();
    if (!liveKernelFactories.has(bound)) {
      const kernels = new Map<string, LiveKernel>();
      liveKernelFactories.set(bound, (entity) => {
        let kernel = kernels.get(entity);
        if (kernel === undefined) {
          kernel = createLiveKernel(env, bound, details, entity, span);
          kernels.set(entity, kernel);
        }
        return kernel;
      });
    }
    const authorities: RequestAuthorities = new WeakMap();
    const config = moduleConfigOf(app.configShapes, details.resolved.backendConfig);
    const target = targetOf(action, details);
    const drive = liveMapDriverOf(
      {
        registry,
        adapter: target.handle.adapter,
        namespace: target.namespace,
        scope: target.scope,
        action,
        request: requestInfoOf(inv),
        config,
        clock: env.options.clock,
        keys: env.options.keys,
        compute: env.options.compute,
        log,
        trace: span,
        rules,
        authorities,
      },
      () => subject,
      inv.signal,
    );
    let plan: LiveSourcePlan | LivePokesPlan;
    if (action.generated === 'watch' && action.entity !== undefined) {
      const watched = input as WatchInput<unknown>;
      plan = {
        entity: action.entity,
        input: watched,
        after: resume?.after ?? (watched.after as StateToken | undefined),
        maps: [],
      };
    } else if (action.generated === undefined) {
      const description = action.handler(
        input,
        sourceContextOf({
          registry,
          rules,
          principal: session.principal,
          scope,
          clock: env.options.clock,
          request: requestInfoOf(inv),
          config,
          log,
          trace: span,
          authorities,
          flags,
          action,
        }),
        resume?.after,
      );
      const planned = planLiveSource(description);
      plan = planned.kind === 'pokes' ? { ...planned, after: resume?.after } : planned;
    } else {
      throw errors.unsupported(`"${action.ref}" is not a live source.`);
    }
    // The view is built, and the token's form and scope checked, before the decision is reported: a
    // refusal of the input is a refusal of the setup, never a failure of the stream.
    if (plan.kind === 'pokes') {
      if (plan.after !== undefined) assertTokenScope(decodeStateToken(plan.after), scope);
      await registerPokesView(env, bound, details, action, span);
    } else {
      await liveKernelOf(bound, plan.entity).prepare(plan.input, plan.after);
    }
    const frames = runLiveSource(hub, bound, plan, drive);
    return {
      frames,
      itemOf: async (frame) => {
        if ('control' in frame) return frame;
        let event = frame.event;
        // A custom subscription's items are what its maps made: they must fit the declared event shape.
        // The kernel builds the items of a generated watch.
        if (action.generated === undefined) {
          const result = await action.output['~standard'].validate(event);
          if (result.issues !== undefined) {
            throw errors.internal(`An item of "${action.ref}" does not fit its event shape.`);
          }
          event = result.value;
        }
        const translated = await translate(translation, 'output', action, event);
        return frame.state === undefined
          ? { event: translated }
          : { event: translated, state: frame.state };
      },
      failure: (error) => {
        const mapped = mapUnknownError(error, env.options.environment, action.errors);
        if (mapped.kind === 'internal') log.error(mapped.message, { cause: mapped.cause });
        return translateError(translation, mapped, action);
      },
    };
  } catch (error) {
    outcome = {
      ok: false,
      error: mapUnknownError(error, env.options.environment, state.action?.errors),
    };
    throw outcome.error;
  } finally {
    complete({ span, log: state.log, action: state.action?.ref ?? inv.action, outcome });
    if (env.options.onDecision !== undefined) {
      try {
        env.options.onDecision({
          kind: 'subscribe',
          requestId: inv.requestId,
          action: state.action?.ref ?? inv.action,
          transport: inv.carrier.transport,
          stage: outcome.ok ? 'complete' : state.stage,
          rules: state.rules ?? (outcome.ok ? [] : (outcome.error.rules ?? [])),
          ...(outcome.ok ? {} : { error: outcome.error }),
        });
      } catch (error) {
        state.log.warn('the decision hook failed', { error: String(error) });
      }
    }
  }
}
