import type { AdmissionInput, AdmissionRule } from '../edge/admission-rule.ts';
import type { AdmissionVerdict } from '../edge/admission-verdict.ts';
import type { BucketDemand } from '../edge/bucket-demand.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { withResolverKit } from '../invoker/edge/with-resolver-kit.ts';
import type { Invocation } from '../invoker/invocation.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import { requestInfoOf } from '../invoker/request-info-of.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { SessionDetails } from '../invoker/session-details.ts';
import type { Span } from '../observability/span.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { checkCharges } from './check-charges.ts';
import type { ModuleCharge } from './module-charge.ts';
import { takeCharges } from './take-charges.ts';
import { tokenBucketPolicy } from './token-bucket-policy.ts';

const point = 'core.invocationMiddleware';

function isRule(value: unknown): value is AdmissionRule {
  return typeof value === 'function';
}

/** What the stage runs on. */
export interface AdmissionRun {
  readonly action: ActionEntry;
  readonly session: InvocationSession;
  readonly details: SessionDetails;
  readonly invocation: Invocation<unknown>;
  readonly span: Span;
  /** Takes the `admit` charges in a unit that rolls back (a dry run), so the answer is real and no token is used. */
  readonly dry?: boolean;
}

/** What admission leaves for the `complete` stage. */
export interface Admitted {
  readonly target: ScopeTarget | null;
  /** Charged after the outcome when the invocation fails with a declared error. */
  readonly onDeclaredError: readonly ModuleCharge[];
}

/**
 * Runs the admission rules of `invocationMiddleware` in fill order (sections 5.6 and 12.2). Rules
 * are pure values over the wire-form input: they answer the buckets to consume or a refusal, and the
 * kernel applies the answer, so no rule wraps or skips a stage. The rules run in one read-only
 * unit; the `admit` charges are then taken in one short read-write unit of the scope, and an
 * empty bucket answers `rate_limited` with `retryAfter`. Without a connected store (a scope with no
 * target) there is nothing to charge and no rule runs.
 */
export async function runAdmission(env: InvokerEnv, run: AdmissionRun): Promise<Admitted> {
  const { action, session, details, invocation, span } = run;
  const { resolved } = details;
  const { target } = resolved;
  const none: Admitted = { target, onDeclaredError: [] };
  if (target === null) return none;
  // A backend-scope action of a tenant session is charged in the backend's own scope (S-36).
  const chargeTarget =
    action.scope === 'backend' && resolved.backendTarget !== null ? resolved.backendTarget : target;
  const { registry } = env.appOf(resolved.app);
  if ((registry.fills.get(point) ?? []).length === 0) return none;
  const admissionInput: AdmissionInput = {
    action: action.ref,
    scope: session.scope,
    principal: session.principal,
    request: requestInfoOf(invocation),
    input: invocation.input,
  };
  const demands = await withResolverKit(
    {
      env,
      registry,
      target,
      backendTarget: resolved.backendTarget,
      transport: invocation.carrier.transport,
      requestId: invocation.requestId,
      span,
    },
    async (kit) => {
      const found: { module: string; demand: BucketDemand }[] = [];
      for (const { module, value } of kit.fills(point, session.principal)) {
        if (!isRule(value)) {
          throw new KeelwerkError({
            kind: 'internal',
            code: 'core.internal',
            message: `A fill of ${point} by "${module}" is not an admission rule.`,
          });
        }
        const verdict = await kit.drive<AdmissionVerdict>(
          value(admissionInput),
          module,
          session.principal,
        );
        if (verdict.kind === 'refuse') throw verdict.error;
        found.push({ module, demand: verdict.demand });
      }
      return found;
    },
  );
  const admit = demands.flatMap(({ module, demand }) =>
    demand.admit.map((charge): ModuleCharge => ({ module, charge })),
  );
  const onDeclaredError = demands.flatMap(({ module, demand }) =>
    demand.onDeclaredError.map((charge): ModuleCharge => ({ module, charge })),
  );
  // A defective failure-only charge fails closed here, as an `admit` charge does, instead of
  // being found only after the outcome.
  for (const { charge } of onDeclaredError) tokenBucketPolicy(charge);
  const waits: number[] = [];
  if (admit.length > 0) {
    const wait = await takeCharges(
      chargeTarget,
      env.options.keys,
      admit,
      run.dry === true ? { rollback: true } : {},
    );
    if (wait !== undefined) waits.push(wait);
  }
  // A failure-only bucket is charged after a declared failure, but an exhausted one refuses the
  // next attempt now (S-85): its level is read without taking.
  if (onDeclaredError.length > 0) {
    const wait = await checkCharges(chargeTarget, env.options.keys, onDeclaredError);
    if (wait !== undefined) waits.push(wait);
  }
  if (waits.length > 0) {
    throw new KeelwerkError({
      kind: 'rate_limited',
      code: 'core.rate_limited',
      message: 'Too many requests.',
      retryAfter: Math.ceil(Math.max(...waits)),
    });
  }
  return { target: chargeTarget, onDeclaredError };
}
