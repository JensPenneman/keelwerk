import type { ActionEntry } from './action-entry.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/** `unknownExecutionOverrides`: an execution override names no command of the app (case 12). */
export function checkUnknownExecutionOverrides(
  app: ComposableApp,
  actions: ReadonlyMap<string, ActionEntry>,
): readonly CompositionProblem[] {
  return Object.keys(app.execution)
    .filter((ref) => actions.get(ref)?.kind !== 'command')
    .map((ref) =>
      compositionError(
        'unknownExecutionOverrides',
        `defineApp({ execution }) names '${ref}', which is not a command of the app.`,
        { ref },
      ),
    );
}
