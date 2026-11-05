import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import type { ScopeTarget } from '../scope-target.ts';
import type { SessionDetails } from '../session-details.ts';

/** A backend-scope action of a tenant session runs in the backend's own unit, so it reaches no tenant data (section 8.8). */
export function targetOf(action: ActionEntry, details: SessionDetails): ScopeTarget {
  const { resolved } = details;
  const target =
    action.scope === 'backend' && resolved.backendTarget !== null
      ? resolved.backendTarget
      : resolved.target;
  if (target === null) {
    throw new KeelwerkError({
      kind: 'unavailable',
      code: 'core.unavailable',
      message: 'No store is connected for this scope.',
    });
  }
  return target;
}
