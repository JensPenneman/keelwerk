import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { Principal } from '../principals/principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Scope } from '../storage/scope.ts';
import { checkEffectScope } from './check-effect-scope.ts';

/**
 * A timer fires in the scope that set it: `checkEffectScope` for the principal whose decision or
 * resolver set it, and `core.request_not_allowed` for every command another scope would run. A
 * timer that crossed scopes would run as the module's service principal, which the module's own
 * rules admit for every action of the module, so it would pass the boundary `enqueue` and `invoke`
 * keep for the source principal; and `cancelTimer` could never beat a firing that began, because
 * the command would commit in the backend unit and the job would settle later in the tenant's.
 * Delayed work across scopes is `enqueue(action, input, { runAt, key })`.
 */
export function checkTimerScope(
  scope: Scope,
  action: Pick<ActionEntry, 'ref' | 'scope'>,
  principal: Pick<Principal, 'kind'>,
): void {
  if (checkEffectScope(scope, action, 'setTimer', principal) === 'backend') {
    throw refuseRequest(
      `setTimer of "${action.ref}"`,
      'a timer does not cross scopes; enqueue the backend command with runAt and key',
    );
  }
}
