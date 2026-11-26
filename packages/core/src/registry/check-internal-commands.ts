import type { ActionEntry } from './action-entry.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/** `internalCommands`: an `internal: true` command must be a command, with `auth: 'policy'` and not offline (section 7.3). */
export function checkInternalCommands(
  actions: ReadonlyMap<string, ActionEntry>,
): readonly CompositionProblem[] {
  return [...actions.values()]
    .filter((action) => action.internal === true)
    .flatMap((action) => {
      const reasons = [
        ...(action.kind === 'command' ? [] : ['only commands can be internal']),
        ...(action.auth === 'policy' ? [] : ['it is public']),
        ...(action.offline ? ['it is offline'] : []),
      ];
      return reasons.length === 0
        ? []
        : [
            compositionError(
              'internalCommands',
              `'${action.ref}' is internal but ${reasons.join(' and ')}.`,
              { module: action.module, ref: action.ref },
            ),
          ];
    });
}
