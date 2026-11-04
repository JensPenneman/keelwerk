import { readActionNames } from './read-action-names.ts';

const writeNames: readonly string[] = ['create', 'update', 'archive', 'restore', 'set'];

/** The action names of a rule once aliases and set operations are expanded. */
export interface ExpandedActions {
  /** `'*'`: every action. */
  readonly all: boolean;
  /** `'read'`: every query and subscription of the target, generated or custom. */
  readonly reads: boolean;
  readonly names: ReadonlySet<string>;
}

/**
 * Expands the action list of a rule (section 8.1): `read` is `get`, `query`, `changes`,
 * `queryChanges`, `watch` and `history` and every other read of the target, `write` is the four
 * operations and `set`, `set` stands for the four operations it batches, and `*` is everything.
 */
export function expandActionAliases(actions: readonly string[]): ExpandedActions {
  const names = new Set<string>();
  let all = false;
  let reads = false;
  for (const action of actions) {
    if (action === '*') all = true;
    else if (action === 'read') {
      reads = true;
      for (const name of readActionNames) names.add(name);
    } else if (action === 'write') {
      for (const name of writeNames) names.add(name);
    } else if (action === 'set') {
      for (const name of writeNames) names.add(name);
    } else names.add(action);
  }
  return { all, reads, names };
}
