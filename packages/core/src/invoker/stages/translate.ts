import { translateInput } from '../../api-versions/translate-input.ts';
import { translateOutput } from '../../api-versions/translate-output.ts';
import { versionChangeFailure } from '../../api-versions/version-change-failure.ts';
import type { VersionTranslation } from '../../api-versions/version-translation.ts';
import { isEmptyShape } from '../../fields/is-empty-shape.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import { issuesOf } from './issues-of.ts';

/**
 * `translate` (section 9.2): the version changes the session's API version lacks, applied to the
 * input (oldest first, then checked against the head schema) and to the shaped output (newest
 * first; `input`, the caller's input in the version's names, limits an answer to the selection the
 * caller made). An action no lacking change touches, and an absent translation (the code's head), pass
 * the value as it is. A subscription calls it once per item frame.
 */
export async function translate(
  translation: VersionTranslation | undefined,
  direction: 'input' | 'output',
  action: ActionEntry,
  value: unknown,
  input?: unknown,
): Promise<unknown> {
  if (translation === undefined || !translation.touched.has(action.ref)) return value;
  if (direction === 'output') return translateOutput(translation, action, value, input);
  const translated = translateInput(
    translation,
    action,
    value === undefined && isEmptyShape(action.input) ? {} : value,
  );
  const result = await action.input['~standard'].validate(translated);
  if (result.issues === undefined) return result.value;
  throw versionChangeFailure({
    change: undefined,
    action: action.ref,
    direction: 'input',
    message: `The input of "${action.ref}" no longer fits its schema after the version changes.`,
    issues: issuesOf(result.issues),
  });
}
