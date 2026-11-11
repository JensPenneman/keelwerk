import { trace } from '@opentelemetry/api';
import { runAdmission } from '../admission/run-admission.ts';
import { effectiveRules } from '../authorization/effective-rules.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import { errors } from '../errors/errors.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import type { Invocation } from '../invoker/invocation.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import { createInvokerEnv } from '../invoker/invoker-env.ts';
import { mapUnknownError } from '../invoker/map-unknown-error.ts';
import type { Outcome } from '../invoker/outcome.ts';
import { authorize } from '../invoker/stages/authorize.ts';
import { locate } from '../invoker/stages/locate.ts';
import { prepare } from '../invoker/stages/prepare.ts';
import { translate } from '../invoker/stages/translate.ts';
import { validate } from '../invoker/stages/validate.ts';
import { withDeadline } from '../invoker/stages/with-deadline.ts';
import type { Registry } from '../registry/registry.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { dryRun } from './dry-run.ts';
import { explainAction } from './explain-action.ts';
import { explainDecision } from './explain-decision.ts';
import type { ExplainEnvironment } from './explain-environment.ts';
import { explainPrincipal } from './explain-principal.ts';
import type { ExplainRequest } from './explain-request.ts';
import { explainTarget } from './explain-target.ts';
import { parseExplainRequest } from './parse-explain-request.ts';
import { traceCommand } from './trace-command.ts';

/**
 * Wraps the invoker so `core.explain` is answered for operators (section 16.9.7): the
 * authorization decision without executing, a dry run in a unit that rolls back, or a command's
 * trace from the chain. `--as` evaluates a decision everywhere and runs a dry run as that
 * principal in development only (decision 17). Every other action passes through.
 */
export function answerExplain(inner: Invoker, env: ExplainEnvironment): Invoker {
  const { options } = env;
  let invokerEnv: InvokerEnv | undefined;
  const admissionEnv = (): InvokerEnv => {
    invokerEnv ??= createInvokerEnv(options);
    return invokerEnv;
  };
  const rulesCache = new WeakMap<Registry, readonly NormalizedRule[]>();
  const rulesOf = (registry: Registry): readonly NormalizedRule[] => {
    const known = rulesCache.get(registry);
    if (known !== undefined) return known;
    const built = effectiveRules(registry);
    rulesCache.set(registry, built);
    return built;
  };

  async function run(
    inv: Invocation<unknown>,
    session: InvocationSession,
    request: ExplainRequest,
    state: { declared: readonly string[] },
  ): Promise<unknown> {
    const explained = await explainTarget(env, request);
    const { scope, app: appId, target, backend } = explained;
    const app = options.apps.get(appId);
    if (app === undefined)
      throw errors.unavailable(`App "${appId}" is not served by this process.`);
    const { registry } = app;
    if (request.mode === 'trace') {
      const found = await traceCommand({
        adapter: target.handle.adapter,
        namespace: target.namespace,
        scope,
        id: request.id,
      });
      return { mode: 'trace', ...found };
    }
    const action = locate(registry, request.ref, scope);
    state.declared = action.errors;
    const dry = request.mode === 'dry-run';
    if (dry) {
      if (action.kind !== 'command') {
        throw errors.validation(`"${action.ref}" is not a command; only a command has a dry run.`);
      }
      if (request.as !== undefined && options.environment === 'production') {
        throw errors.forbidden(
          '--as runs the command as another principal, which only a development process does.',
        );
      }
    }
    const principal = await explainPrincipal({
      env: admissionEnv(),
      app,
      target: explained,
      session,
      as: request.as,
      transport: inv.carrier.transport,
      requestId: inv.requestId,
    });
    const rules = rulesOf(registry);
    if (dry) {
      // Admission runs as for a real call, but its charges are taken in a unit that rolls back:
      // a dry run reports a refusal or `rate_limited` without using up tokens.
      const resolvedBackend = scope.level === 'tenant' ? (backend ?? null) : null;
      const admissionSpan = trace.getTracer('keelwerk').startSpan('keelwerk.explain.admission');
      try {
        await runAdmission(admissionEnv(), {
          action,
          session: { ...session, principal, scope },
          details: {
            resolved: {
              scope,
              app: appId,
              resolvedBy: session.resolvedBy,
              target,
              backendTarget: resolvedBackend,
            },
            carrier: inv.carrier,
          },
          invocation: { ...inv, action: action.ref, input: request.input },
          span: admissionSpan,
          dry: true,
        });
      } finally {
        admissionSpan.end();
      }
    }
    const validated =
      request.input === undefined ? undefined : await validate(action, request.input);
    const value =
      validated === undefined ? undefined : await translate(undefined, 'input', action, validated);
    const explanation = explainDecision({
      registry,
      rules,
      action,
      context: principalContextOf(registry, principal, scope),
      transport: inv.carrier.transport,
      input: value,
    });
    if (!dry) return { mode: 'decision', ...explanation };

    const dryInput =
      request.input === undefined
        ? await translate(undefined, 'input', action, await validate(action, {}))
        : value;
    authorize({
      registry,
      rules,
      action,
      session: { ...session, principal, scope },
      transport: inv.carrier.transport,
      value: dryInput,
    });
    prepare(action);
    const span = trace.getTracer('keelwerk').startSpan('keelwerk.explain');
    try {
      const report = await withDeadline(
        (signal) =>
          dryRun({
            registry,
            adapter: target.handle.adapter,
            namespace: target.namespace,
            scope,
            action,
            input: dryInput,
            principal,
            request: { transport: inv.carrier.transport, requestId: inv.requestId },
            clock: options.clock,
            keys: options.keys,
            compute: options.compute,
            log: options.log,
            trace: span,
            rules,
            apiVersion: session.apiVersion,
            build: options.build ?? { id: 'development', revision: 1 },
            behaviours: registryBehaviours(registry),
            hybridClock: env.hybridClock,
            signal,
            namespaceOf: (scope) =>
              scope.level === 'backend' ? (backend ?? target).namespace : target.namespace,
            ...(target.handle.capabilities === undefined
              ? {}
              : { concurrentUnits: target.handle.capabilities.processes !== 'single' }),
            ...(request.commandId === undefined ? {} : { commandId: request.commandId }),
            ...(request.answers === undefined ? {} : { answers: request.answers }),
          }),
        {
          clientSignal: inv.signal,
          ...(action.timeoutMs === undefined ? {} : { timeoutMs: action.timeoutMs }),
        },
      );
      return { mode: 'dry-run', authorization: explanation, report };
    } finally {
      span.end();
    }
  }

  return {
    ...inner,
    invoke: async <I, O>(inv: Invocation<I>): Promise<Outcome<O>> => {
      if (inv.action !== explainAction) return inner.invoke<I, O>(inv);
      const state: { declared: readonly string[] } = { declared: [] };
      try {
        const opened =
          inv.session === undefined
            ? await inner.open(inv.carrier, { signal: inv.signal })
            : ({ ok: true, value: inv.session } as const);
        if (!opened.ok) return opened;
        if (opened.value.principal.kind !== 'operator') {
          throw errors.forbidden('keelwerk explain is for operators.');
        }
        if (inv.carrier.local === undefined && options.environment !== 'development') {
          throw errors.forbidden(
            'keelwerk explain is answered on the operator socket, or in development.',
          );
        }
        const value = await run(inv, opened.value, parseExplainRequest(inv.input), state);
        return { ok: true, value: value as O };
      } catch (error) {
        return { ok: false, error: mapUnknownError(error, options.environment, state.declared) };
      }
    },
  };
}
