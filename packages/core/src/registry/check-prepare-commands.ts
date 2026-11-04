import type { ActionEntry } from './action-entry.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/** `prepareNeedsSyncExecution`: `prepare` exists only on `execution: 'sync'` commands (section 7.9.4). */
export function checkPrepareCommands(
  actions: ReadonlyMap<string, ActionEntry>,
): readonly CompositionProblem[] {
  return [...actions.values()]
    .filter((action) => action.prepare !== undefined && action.execution !== 'sync')
    .map((action) =>
      compositionError(
        'prepareNeedsSyncExecution',
        `'${action.ref}' declares prepare but its execution is '${action.execution}'.`,
        { module: action.module, ref: action.ref },
      ),
    );
}
