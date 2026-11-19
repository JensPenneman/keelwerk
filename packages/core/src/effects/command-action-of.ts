import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { erasureAction } from '../subjects/erasure-action.ts';

/**
 * The command an `invoke`, `enqueue` or timer names (a principal resolver's effects too); anything
 * else is not allowed. `core.eraseSubject` is never a target: an effect is not judged by the
 * target's rules, and only the rules and the ownership check of `acceptAsyncCommand`, or the
 * own-subject request of `eraseOwnSubject`, after `checkOwnSubjectErasure`, may start an erasure
 * (section 14.7.5).
 */
export function commandActionOf(registry: Registry, ref: string, effect: string): ActionEntry {
  const action = registry.actions.get(ref);
  if (action === undefined || action.kind !== 'command') {
    throw refuseRequest(`${effect} of "${ref}"`, 'it names no command of this app');
  }
  if (action.ref === erasureAction) {
    throw refuseRequest(
      `${effect} of "${ref}"`,
      'an erasure starts only from a request a rule allowed, never from an effect',
    );
  }
  return action;
}
