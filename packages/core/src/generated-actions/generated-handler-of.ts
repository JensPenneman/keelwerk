import { errors } from '../errors/errors.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { ActionHandler } from '../registry/action-handler.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { registerGeneratedActions } from './register-generated-actions.ts';

/** The `decide` of a generated command (`create`, `update`, `archive`, `restore`) for its entity. */
export function generatedHandlerOf(action: ActionEntry, entry: EntityEntry): ActionHandler {
  const factory =
    action.generated === undefined
      ? undefined
      : registerGeneratedActions().handlers[action.generated];
  if (factory === undefined)
    throw errors.internal(`"${action.ref}" is a generated action with no command handler`);
  return factory(entry);
}
