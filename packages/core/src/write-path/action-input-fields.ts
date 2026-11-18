import type { AnyField } from '../fields/field-def.ts';
import type { ActionEntry } from '../registry/action-entry.ts';

/**
 * The fields of the action's input, when it declares any (the input of a module command is a
 * shape); `undefined` for any other input.
 */
export function actionInputFields(
  action: ActionEntry,
): Readonly<Record<string, AnyField>> | undefined {
  return (action.input as unknown as { readonly fields?: Readonly<Record<string, AnyField>> })
    ?.fields;
}
