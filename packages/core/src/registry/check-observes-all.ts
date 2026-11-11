import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';

/** `observesAllUndeclared` (G12): only a module whose base declares `observes: 'all'` may react with `on: 'all'`. */
export function checkObservesAll(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const observing = new Set(
    registry.modules.filter((module) => module.observes === 'all').map((module) => module.id),
  );
  return [...registry.reactions.values()]
    .filter((reaction) => reaction.on === 'all' && !observing.has(reaction.module))
    .map((reaction) =>
      compositionError(
        'observesAllUndeclared',
        `The reaction '${reaction.id}' observes every event, and module '${reaction.module}' does not declare observes: 'all'.`,
        { module: reaction.module, ref: reaction.id },
      ),
    );
}
