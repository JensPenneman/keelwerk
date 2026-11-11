import type { ActionEntry } from '../registry/action-entry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import { applyTransform } from './apply-transform.ts';
import { mechanicalInput } from './mechanical-input.ts';
import { transformKey } from './transform-key.ts';
import type { VersionTranslation } from './version-translation.ts';

/**
 * An older version's input to the head's (section 18.2): the changes the version lacks, oldest
 * first, each with its mechanical part (renamed, dropped and defaulted fields, in rows, selections,
 * sorts and filters) and then its custom transform, which sees the change's newer names. A
 * transform that throws or returns a non-object is `core.version_change_failed`. `beyond` are
 * changes that come after the last lacking one without being applied here (a fixture runs one
 * change and then the later ones): they only tell a field added here its head name.
 */
export function translateInput(
  translation: VersionTranslation,
  action: ActionEntry,
  value: unknown,
  beyond: readonly VersionChangeEntry[] = [],
): unknown {
  let next = value;
  translation.lacking.forEach((change, index) => {
    const key = transformKey(translation, change, action.ref);
    next = mechanicalInput(
      translation.registry,
      change,
      action,
      next,
      [...translation.lacking.slice(index + 1), ...beyond],
      change.output[key] !== undefined,
    );
    const transform = change.input[key];
    if (transform !== undefined)
      next = applyTransform(change, action.ref, 'input', transform, next);
  });
  return next;
}
