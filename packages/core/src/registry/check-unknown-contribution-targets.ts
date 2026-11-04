import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/** `unknownContributionTargets`: a contribution names an entity its selected target does not define (case 7). */
export function checkUnknownContributionTargets(
  selection: AppSelection,
  parts: readonly AppliedPart[],
): readonly CompositionProblem[] {
  return parts.flatMap((part) => {
    const target = selection.byId.get(part.target);
    if (part.kind !== 'contribution' || target === undefined) return [];
    return Object.keys(part.entities)
      .filter((entity) => !Object.hasOwn(target.entities, entity))
      .map((entity) =>
        compositionError(
          'unknownContributionTargets',
          `${part.declaredBy.id} -> ${part.target}.${entity}: '${part.target}' defines no entity '${entity}'.`,
          { module: part.declaredBy.id, ref: `${part.target}.${entity}` },
        ),
      );
  });
}
