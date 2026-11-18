import { scopeRefusal } from '../authorization/scope-refusal.ts';
import type { ServicePrincipal } from '../principals/service-principal.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Scope } from '../storage/scope.ts';

/** The kind of the principal every reaction job runs under (`moduleServicePrincipal`). */
const jobPrincipalKind: ServicePrincipal['kind'] = 'service';

/**
 * Whether a job of the async reaction for an event of `scope` passes the scope rule the invoker
 * applies (`scopeRefusal`, 7.7, 8.8): the job decides as `reactionJobAction` builds it, at the
 * event's level, under the module's service principal. False for an event of the deployment (a
 * deployment-scope action is for operator principals only), true for a tenant or backend event.
 */
export function reactionDecidesIn(reaction: Pick<ReactionEntry, 'id'>, scope: Scope): boolean {
  return (
    scopeRefusal({ ref: reaction.id, scope: scope.level }, scope.level, jobPrincipalKind) ===
    undefined
  );
}
