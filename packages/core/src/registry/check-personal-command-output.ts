import { personalInputField } from '../effects/personal-input-field.ts';
import type { ActionEntry } from './action-entry.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/**
 * `personalCommandOutput`: a command whose output is not a row of an entity keeps its output in
 * the receipt as given (section 15.1.7), and the receipt holds no sealed personal value, so an
 * output with a personal field is refused where the app is composed.
 */
export function checkPersonalCommandOutput(
  actions: ReadonlyMap<string, ActionEntry>,
): readonly CompositionProblem[] {
  return [...actions.values()]
    .filter((action) => action.kind === 'command' && action.entityOutput === undefined)
    .flatMap((action) => {
      const field = personalInputField(action.output);
      return field === undefined
        ? []
        : [
            compositionError(
              'personalCommandOutput',
              `'${action.ref}' outputs the personal field '${field}'; a receipt keeps the output in plaintext, so return a row of the entity or leave the field out.`,
              { module: action.module, ref: action.ref },
            ),
          ];
    });
}
