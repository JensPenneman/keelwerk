import type { AppSelection } from './app-selection.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/** `missingModules`: a required module is not selected, or a required app-level contract is not provided (cases 5 and 11). */
export function checkMissingModules(selection: AppSelection): readonly CompositionProblem[] {
  return selection.modules.flatMap((module) =>
    module.requires.flatMap((dependency) => {
      if (dependency.kind === 'module') {
        return selection.byId.has(dependency.id)
          ? []
          : [
              compositionError(
                'missingModules',
                `Module '${module.id}' requires module '${dependency.id}', which is not selected.`,
                { module: module.id, ref: dependency.id },
              ),
            ];
      }
      return dependency.level === 'app' && !selection.provided.has(dependency.contract)
        ? [
            compositionError(
              'missingModules',
              `Module '${module.id}' requires the contract '${dependency.contract}', which no selected module provides.`,
              { module: module.id, ref: dependency.contract },
            ),
          ]
        : [];
    }),
  );
}
