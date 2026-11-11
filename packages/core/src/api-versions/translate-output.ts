import type { ActionEntry } from '../registry/action-entry.ts';
import { applyOutputTransform } from './apply-output-transform.ts';
import { mechanicalOutput } from './mechanical-output.ts';
import { narrowToSelection } from './narrow-to-selection.ts';
import { transformKey } from './transform-key.ts';
import type { VersionTranslation } from './version-translation.ts';

/**
 * The shaped head output in an older version's names (section 18.2): the changes the version
 * lacks, newest first, each with its custom transform, which sees the newer names, and then its
 * mechanical part. The `$masked` names of a row follow the renames, and a transform sees no masked
 * value (`applyOutputTransform`). `input`, the caller's input in
 * the version's names, limits the answer to the selection the caller made, since the head may have
 * been asked for more than that (`mechanicalInput`). A transform that throws or returns a
 * non-object is `core.version_change_failed`.
 */
export function translateOutput(
  translation: VersionTranslation,
  action: ActionEntry,
  value: unknown,
  input?: unknown,
): unknown {
  let next = value;
  for (const change of [...translation.lacking].reverse()) {
    const transform = change.output[transformKey(translation, change, action.ref)];
    if (transform !== undefined) next = applyOutputTransform(change, action, transform, next);
    next = mechanicalOutput(change, action, next);
  }
  return narrowToSelection(action, input, next);
}
