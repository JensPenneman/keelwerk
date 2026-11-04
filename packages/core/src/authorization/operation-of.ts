import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { AuthorizedAction } from './authorized-action.ts';
import type { PlanOperation } from './plan-operation.ts';

/**
 * The plan operation of an action (section 8.2): reads select rows, creates test the new row,
 * everything that changes a row it targets (`update`, `archive`, `restore`, custom instance
 * commands) is a transition. A batch `set` has no operation of its own: each item is authorized
 * against its own operation (`itemAction`).
 */
export function operationOf(action: AuthorizedAction): PlanOperation {
  if (action.generated === 'set') {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: `"${action.ref}" is a batch: authorize each item against its own operation.`,
    });
  }
  if (action.kind !== 'command') return 'read';
  if (action.generated === 'create') return 'create';
  return action.instance ? 'transition' : 'create';
}
