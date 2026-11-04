import type { ActionEntry } from './action-entry.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/** `offlineCommands`: an `offline: true` command must be synchronous with `auth: 'policy'` and declare no `prepare` (section 7.3). */
export function checkOfflineCommands(
  actions: ReadonlyMap<string, ActionEntry>,
): readonly CompositionProblem[] {
  return [...actions.values()]
    .filter((action) => action.offline)
    .flatMap((action) => {
      const reasons = [
        ...(action.kind === 'command' ? [] : ['only commands can be offline']),
        ...(action.execution === 'sync' ? [] : [`its execution is '${action.execution}'`]),
        ...(action.auth === 'policy' ? [] : ['it is public']),
        ...(action.prepare === undefined ? [] : ['it declares prepare']),
      ];
      return reasons.length === 0
        ? []
        : [
            compositionError(
              'offlineCommands',
              `'${action.ref}' is offline but ${reasons.join(' and ')}.`,
              {
                module: action.module,
                ref: action.ref,
              },
            ),
          ];
    });
}
