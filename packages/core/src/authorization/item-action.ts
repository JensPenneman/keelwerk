import type { AuthorizedAction } from './authorized-action.ts';

/** The action one item of a batch `set` is authorized as: its operation under the entity's name. */
export function itemAction(
  set: AuthorizedAction,
  operation: 'create' | 'update' | 'archive' | 'restore',
): AuthorizedAction {
  const prefix = set.ref.slice(0, set.ref.length - set.name.length);
  return {
    ...set,
    ref: `${prefix}${operation}`,
    name: operation,
    kind: 'command',
    generated: operation,
    instance: operation !== 'create',
  };
}
