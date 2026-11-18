import { acceptedScopeLevels } from '../invoker/stages/accepted-scope-levels.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Scope } from '../storage/scope.ts';

/**
 * The gate's scope rule (8.4, 8.8): why an action at `action.scope` is refused to a principal of
 * `kind` in a unit at `level`, or undefined when the scope allows it. A level the action does not
 * accept (`acceptedScopeLevels`): `"<ref>" runs at the <action scope> level, not at <level>.`; a
 * deployment-scope action and any kind but `operator`: `"<ref>" is reachable by operator principals
 * only.` Rules and the principal's own backend and tenant are the gate's, not this function's.
 */
export function scopeRefusal(
  action: Pick<ActionEntry, 'ref' | 'scope'>,
  level: Scope['level'],
  kind: PrincipalKind,
): string | undefined {
  if (!acceptedScopeLevels[action.scope].includes(level)) {
    return `"${action.ref}" runs at the ${action.scope} level, not at ${level}.`;
  }
  if (action.scope === 'deployment' && kind !== 'operator') {
    return `"${action.ref}" is reachable by operator principals only.`;
  }
  return undefined;
}
