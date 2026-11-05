import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import { isEmptyShape } from '../../fields/is-empty-shape.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';
import { issuesOf } from './issues-of.ts';

/**
 * `validate` (section 9.2): the input against the action's schema. Returns the schema's output,
 * with its defaults filled in; failures are `validation` with the schema's issues. An action
 * without input fields (`void` on the surface) takes `undefined` as `{}`; `null` stays refused.
 */
export async function validate(action: ActionEntry, input: unknown): Promise<unknown> {
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
