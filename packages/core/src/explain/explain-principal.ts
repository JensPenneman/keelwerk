import { trace } from '@opentelemetry/api';
import { runPrincipalEnrichers } from '../invoker/edge/run-principal-enrichers.ts';
import { withResolverKit } from '../invoker/edge/with-resolver-kit.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { InvokerApp } from '../invoker/invoker-app.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import { moduleConfigOf } from '../invoker/module-config-of.ts';
import type { Principal } from '../principals/principal.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import { principalOfActor } from '../replay/principal-of-actor.ts';
import type { ExplainAs } from './explain-request.ts';
import type { ExplainTarget } from './explain-target.ts';

const moduleSuffix = '.system';

/** M for `<M>.system` when M is a module of the app. */
function moduleOfSystemId(id: string | undefined, app: InvokerApp): string | undefined {
  if (id === undefined || !id.endsWith(moduleSuffix)) return undefined;
  const module = id.slice(0, -moduleSuffix.length);
  return app.registry.modules.some((m) => m.id === module) ? module : undefined;
}

/** What the principal of an explanation is built from. */
export interface ExplainPrincipalInput {
  /** `answerExplain`'s `admissionEnv()`. */
  readonly env: InvokerEnv;
  readonly app: InvokerApp;
  readonly target: ExplainTarget;
  /** The operator's session; its principal is the answer when `as` is absent. */
  readonly session: InvocationSession;
  readonly as: ExplainAs | undefined;
  readonly transport: string;
  readonly requestId: string;
}

/**
 * The principal a decision or dry run is evaluated as (section 16.9.7, open point 451). Without
 * `--as`, the session's own principal. With it, `principalOfActor({ kind, id: id ?? null, via:
 * 'explain' }, target.scope)`, except `--as service:<M>.system` for a module M of the app, which is
 * the principal the kernel mints for M (no enrichers, no `--roles`). Any other user or service passes
 * through the app's principal enrichers in a read-only unit of `target` (span `keelwerk.explain.principal`; `backendTarget` is
 * `target.backend` at tenant scope, else null; config from `moduleConfigOf(app.configShapes,
 * target.backendConfig)`), and `--roles` is added to the enriched roles, de-duplicated, in order.
 * Other kinds get only `--roles` and open no unit. An enricher's failure and a fill that is not an
 * enricher (`core.internal`) propagate; `answerExplain` maps them as it maps any other error.
 */
export async function explainPrincipal(input: ExplainPrincipalInput): Promise<Principal> {
  const { as, target } = input;
  if (as === undefined) return input.session.principal;
  const module = as.kind === 'service' ? moduleOfSystemId(as.id, input.app) : undefined;
  if (module !== undefined) {
    // The kernel's own principal of a module: it carries no roles, enrichers or `--roles`, and is
    // returned as minted because a copy would lose what the default rule recognises it by.
    return moduleServicePrincipal(module, {
      scope: {
        backend: target.scope.level === 'deployment' ? null : target.scope.backendId,
        tenant: target.scope.level === 'tenant' ? target.scope.tenantId : null,
      },
    });
  }
  const stand = principalOfActor(
    { kind: as.kind, id: as.id ?? null, via: 'explain' },
    target.scope,
  );
  let enriched = stand;
  if (stand.kind === 'user' || stand.kind === 'service') {
    const span = trace.getTracer('keelwerk').startSpan('keelwerk.explain.principal');
    try {
      enriched = await withResolverKit(
        {
          env: input.env,
          registry: input.app.registry,
          target: target.target,
          backendTarget: target.scope.level === 'tenant' ? (target.backend ?? null) : null,
          config: moduleConfigOf(input.app.configShapes, target.backendConfig),
          transport: input.transport,
          requestId: input.requestId,
          span,
        },
        (kit) => runPrincipalEnrichers(kit, stand),
      );
    } finally {
      span.end();
    }
  }
  return { ...enriched, roles: [...new Set([...enriched.roles, ...as.roles])] };
}
