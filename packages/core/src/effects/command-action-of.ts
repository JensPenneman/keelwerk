import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';

/** The command an `invoke`, `enqueue` or timer names; anything else is not allowed. */
export function commandActionOf(registry: Registry, ref: string, effect: string): ActionEntry {
  const action = registry.actions.get(ref);
  if (action === undefined || action.kind !== 'command') {
    throw refuseRequest(`${effect} of "${ref}"`, 'it names no command of this app');
  }
  return action;
}
