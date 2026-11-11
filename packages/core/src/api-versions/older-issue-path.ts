import type { ActionEntry } from '../registry/action-entry.ts';
import { entityPositions } from './entity-positions.ts';
import { fieldChangesOf } from './field-changes-of.ts';
import { issueMemberIndex } from './issue-member-index.ts';
import type { VersionTranslation } from './version-translation.ts';

/**
 * An issue path of the head's input as the version shows it (section 18.2): the member of a row
 * the version's lacking renames introduced takes its older name, and a member the version lacks
 * (an added required field) points at the nearest parent the version knows. A path outside the
 * rows of the action's entity is returned as it is.
 */
export function olderIssuePath(
  translation: VersionTranslation,
  action: ActionEntry,
  path: readonly PropertyKey[],
): readonly PropertyKey[] {
  const positions = entityPositions(action);
  if (positions === undefined) return path;
  for (const position of positions.inputRows) {
    const index = issueMemberIndex(path, position);
    if (index < 0) continue;
    let member = path[index];
    for (const change of [...translation.lacking].reverse()) {
      for (const item of [...fieldChangesOf(change)].reverse()) {
        if (item.entity !== positions.entity || item.field !== member) continue;
        if (item.kind === 'added') return path.slice(0, index);
        if (item.kind === 'renamed') member = item.was;
      }
    }
    if (member === path[index]) return path;
    return [...path.slice(0, index), member as PropertyKey, ...path.slice(index + 1)];
  }
  return path;
}
