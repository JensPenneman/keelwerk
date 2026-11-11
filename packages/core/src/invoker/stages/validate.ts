import { checkVersionInput } from '../../api-versions/check-version-input.ts';
import type { VersionTranslation } from '../../api-versions/version-translation.ts';
import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import { isEmptyShape } from '../../fields/is-empty-shape.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import { issuesOf } from './issues-of.ts';

/**
 * `validate` (section 9.2): the input against the action's schema. Returns the schema's output,
 * with its defaults filled in; failures are `validation` with the schema's issues. An action
 * without input fields (`void` on the surface) takes `undefined` as `{}`; `null` stays refused.
 * An action a lacking version change touches is checked as the session's version sees it
 * (`checkVersionInput`) and its input is returned as sent: `translate` renames it and applies the
 * head schema.
 */
export async function validate(
  action: ActionEntry,
  input: unknown,
  translation?: VersionTranslation,
): Promise<unknown> {
  if (translation?.touched.has(action.ref) === true) {
    await checkVersionInput(translation, action, input);
    return input;
  }
  const result = await action.input['~standard'].validate(
    input === undefined && isEmptyShape(action.input) ? {} : input,
  );
  if (result.issues === undefined) return result.value;
  throw new KeelwerkError({
    kind: 'validation',
    code: 'core.validation',
    message: `The input of "${action.ref}" does not match its schema.`,
    issues: issuesOf(result.issues),
  });
}
