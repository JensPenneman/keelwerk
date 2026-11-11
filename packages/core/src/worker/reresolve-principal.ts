import type { PrincipalResolution } from '../edge/principal-resolution.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import { principalRefOf } from '../effects/principal-ref-of.ts';
import { systemPrincipalOf } from '../effects/system-principal-of.ts';
import { errors } from '../errors/errors.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import { placeholderPrincipal } from '../invoker/edge/placeholder-principal.ts';
import { runPrincipalEnrichers } from '../invoker/edge/run-principal-enrichers.ts';
import type { ResolvedPrincipal } from '../invoker/edge/run-principal-resolvers.ts';
import { withResolverKit } from '../invoker/edge/with-resolver-kit.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import type { JobCarrier } from '../invoker/job-carrier.ts';
import { moduleConfigOf } from '../invoker/module-config-of.ts';
import type { ResolvedScope } from '../invoker/resolved-scope.ts';
import type { Span } from '../observability/span.ts';
import type { OperatorPrincipal } from '../principals/operator-principal.ts';
import type { Principal } from '../principals/principal.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import { moduleResolver } from '../reactions/module-resolver.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';

const moduleSuffix = '.system';

function unresolved(): KeelwerkError {
  return errors.unauthenticated('The principal of this job no longer resolves.');
}

function isResolver(value: unknown): value is PrincipalResolver {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'resolve' in value &&
    typeof value.resolve === 'function'
  );
}

/**
 * Whether the principal a resolver answered is the one the reference names: never an anonymous or
 * a system principal (the kernel's own references carry those), and its reference is the stored
 * resolver and principal id, so a session row that was reused or now points at another subject
 * never runs the job as someone else. An operator is allowed because a resolver may already answer
 * one at request time (the harness's `operators` option does); what the job runs as is still the
 * principal the reference names.
 */
function isReferred(principal: Principal, ref: PrincipalRef): boolean {
  if (principal.kind === 'anonymous' || principal.kind === 'system') return false;
  const answered = principalRefOf(principal);
  return answered.resolver === ref.resolver && answered.principalId === ref.principalId;
}

function resolved(principal: Principal, authenticated: boolean): ResolvedPrincipal {
  return { principal, effects: [], clearCookies: [], authenticated };
}

/** The operator the runtime or a local carrier acts as: its reference names it, nothing else is stored. */
function operatorOf(job: JobCarrier, placeholder: Principal): OperatorPrincipal {
  const ref = job.principal;
  return {
    kind: 'operator',
    id: ref.principalId,
    scope: placeholder.scope,
    claims: {},
    roles: [],
    memberships: [],
    via: ref.resolver,
    ref,
  };
}

/**
 * Re-resolves the principal of a job from its stored reference when the job runs (7.4, S-122, D5),
 * so a revoked key or a deleted user fails the job closed. The kernel's own references need no
 * resolver: `core.module` is `<module>.system`, `core.system` the system principal of its reason,
 * `core.operator` and `core.runtime` the operator the reference names, and `core.invoker` the
 * anonymous placeholder. Any other reference goes to the app's principal resolver of that id: its
 * `fromRef` is driven in the read-only unit of the scope and the principal enrichers run on what it
 * returns. No such resolver, no `fromRef` (also logged as a warning: the compose check only sees
 * resolvers that are not built per request), an answer of null, an anonymous or a system
 * principal, or one whose reference is not the stored one is `unauthenticated`. The effects a
 * resolution asks for are dropped: a job's resolution has no session to extend.
 */
export async function reresolvePrincipal(
  env: InvokerEnv,
  job: JobCarrier,
  resolvedScope: ResolvedScope,
  context: { readonly requestId: string; readonly span: Span },
): Promise<ResolvedPrincipal> {
  const { scope } = resolvedScope;
  const ref = job.principal;
  const placeholder = placeholderPrincipal(scope);
  switch (ref.resolver) {
    case moduleResolver: {
      const module = ref.principalId.endsWith(moduleSuffix)
        ? ref.principalId.slice(0, -moduleSuffix.length)
        : undefined;
      if (
        module === undefined ||
        !env.appOf(resolvedScope.app).registry.modules.some((m) => m.id === module)
      ) {
        throw unresolved();
      }
      return resolved(moduleServicePrincipal(module, placeholder), true);
    }
    case 'core.system':
      return resolved(systemPrincipalOf(ref.principalId, placeholder), true);
    case 'core.operator':
    case 'core.runtime':
      return resolved(operatorOf(job, placeholder), true);
    case 'core.invoker':
      return resolved(placeholder, false);
    default:
      break;
  }
  const { target } = resolvedScope;
  if (target === null) throw unresolved();
  const { registry, configShapes } = env.appOf(resolvedScope.app);
  const principal = await withResolverKit(
    {
      env,
      registry,
      target,
      backendTarget: resolvedScope.backendTarget,
      config: moduleConfigOf(configShapes, resolvedScope.backendConfig),
      transport: 'job',
      requestId: context.requestId,
      span: context.span,
    },
    async (kit) => {
      for (const { module, value } of kit.fills('core.principalResolvers', placeholder)) {
        if (!isResolver(value) || value.id !== ref.resolver) continue;
        if (value.fromRef === undefined) {
          env.options.log.warn(
            `The principal resolver '${value.id}' of '${module}' has no fromRef, so the jobs it authenticated fail unauthenticated.`,
            { resolver: value.id, module },
          );
          continue;
        }
        const resolution = await kit.drive<PrincipalResolution | null>(
          value.fromRef(ref, { scope, clock: env.options.clock }),
          module,
          placeholder,
        );
        if (resolution === null || !isReferred(resolution.principal, ref)) throw unresolved();
        return runPrincipalEnrichers(kit, {
          ...resolution.principal,
          scope: placeholder.scope,
        });
      }
      throw unresolved();
    },
  );
  return resolved(principal, true);
}
