import type { AppSelection } from './app-selection.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { dependencyName } from './dependency-name.ts';

/**
 * `contributionsOutsideDependencies`: a module may contribute only to modules it lists in
 * `requires` or `optional` (section 5.3); the implicit `core` is always active and exempt (5.6).
 */
export function checkContributionsOutsideDependencies(
  selection: AppSelection,
): readonly CompositionProblem[] {
  return [...selection.byId.values()].flatMap((module) => {
    const listed = [...module.requires, ...module.optional]
      .filter((dependency) => dependency.kind === 'module')
      .map(dependencyName);
    return module.contributes
      .filter(
        (contribution) => contribution.to.id !== 'core' && !listed.includes(contribution.to.id),
      )
      .map((contribution) =>
        compositionError(
          'contributionsOutsideDependencies',
          `${module.id}->${contribution.to.id}: '${module.id}' lists '${contribution.to.id}' in neither 'requires' nor 'optional'.`,
          { module: module.id, ref: `${module.id}->${contribution.to.id}` },
        ),
      );
  });
}
