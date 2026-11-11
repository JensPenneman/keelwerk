import type { ResolvedPrincipal } from '../invoker/edge/run-principal-resolvers.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import type { JobCarrier } from '../invoker/job-carrier.ts';
import type { ResolvedScope } from '../invoker/resolved-scope.ts';
import type { Span } from '../observability/span.ts';
import { resolvePrincipalRef } from './resolve-principal-ref.ts';

/**
 * Re-resolves the principal of a job from its stored reference when the job runs (7.4, S-122, D5),
 * so a revoked key or a deleted user fails the job closed; the reference is resolved by
 * `resolvePrincipalRef`.
 */
export function reresolvePrincipal(
  env: InvokerEnv,
  job: JobCarrier,
  resolvedScope: ResolvedScope,
  context: { readonly requestId: string; readonly span: Span },
): Promise<ResolvedPrincipal> {
  return resolvePrincipalRef(env, job.principal, resolvedScope, context);
}
