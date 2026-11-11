import { refuseRequest } from '../interpreter/refuse-request.ts';
import { acceptedScopeLevels } from '../invoker/stages/accepted-scope-levels.ts';
import type { Principal } from '../principals/principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Scope } from '../storage/scope.ts';

/**
 * Where the command an enqueue, invoke or timer effect names runs from a unit at `scope` (7.9.5,
 * 12.3, register entry 345): `'same'` for the unit's own level or an invocation action, `'backend'`
 * for a backend action from a tenant unit (the job stays in the tenant's unit, and the invoker runs
 * the action in that tenant's own backend unit, as it does for a tenant session). Every pair
 * `acceptedScopeLevels` refuses, and `'backend'` for a principal of kind `system`, is `internal`
 * `core.request_not_allowed` naming the effect and both levels: no effect can name another tenant,
 * a backend command cannot reach a tenant, and nothing reaches the deployment from below.
 */
export function checkEffectScope(
  scope: Scope,
  action: Pick<ActionEntry, 'ref' | 'scope'>,
  effect: string,
  principal: Pick<Principal, 'kind'>,
): 'same' | 'backend' {
  const subject = `${effect} of "${action.ref}"`;
  if (!acceptedScopeLevels[action.scope].includes(scope.level)) {
    throw refuseRequest(
      subject,
      `the command runs at the ${action.scope} level and this unit is at the ${scope.level} level; a command may be reached from its own level and a backend command from its tenants only`,
    );
  }
  if (action.scope === scope.level || action.scope === 'invocation') return 'same';
  if (principal.kind === 'system') {
    throw refuseRequest(
      subject,
      `a system principal does not cross scopes: the ${action.scope} command is reached from the ${scope.level} level`,
    );
  }
  return 'backend';
}
