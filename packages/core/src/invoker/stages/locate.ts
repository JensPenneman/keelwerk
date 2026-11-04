import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { Registry } from '../../registry/registry.ts';
import type { Scope } from '../../storage/scope.ts';

/** The session scope levels an action of each scope level accepts (section 8.8). */
const accepted: Readonly<Record<ActionEntry['scope'], readonly Scope['level'][]>> = {
  tenant: ['tenant'],
  backend: ['backend', 'tenant'],
  deployment: ['deployment'],
};

/**
 * `locate` (section 9.2): the action in the app's registry. `not_implemented` when the app lacks
 * the module or the action; `forbidden` when the action's scope level does not match the session's.
 */
export function locate(registry: Registry, ref: string, scope: Scope): ActionEntry {
  const action = registry.actions.get(ref);
  if (action === undefined) {
    throw new KeelwerkError({
      kind: 'not_implemented',
      code: 'core.not_implemented',
      message: `"${ref}" is not an action of this app.`,
    });
  }
  if (!accepted[action.scope].includes(scope.level)) {
    throw new KeelwerkError({
      kind: 'forbidden',
      code: 'core.forbidden',
      message: `"${ref}" runs at the ${action.scope} level, not at ${scope.level}.`,
    });
  }
  return action;
}
