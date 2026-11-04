import type { AppSelection } from './app-selection.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/** `unknownConditionTargets`: a conditional part patches an entity its module does not own (section 5.4). */
export function checkUnknownConditionTargets(
  selection: AppSelection,
): readonly CompositionProblem[] {
  return [...selection.byId.values()].flatMap((module) =>
    module.conditional.flatMap((conditional) =>
      Object.keys(conditional.entities)
        .filter((entity) => !Object.hasOwn(module.entities, entity))
        .map((entity) =>
          compositionError(
            'unknownConditionTargets',
            `${module.id}[${conditional.key}].${entity}: '${module.id}' owns no entity '${entity}'.`,
            { module: module.id, ref: `${module.id}[${conditional.key}].${entity}` },
          ),
        ),
    ),
  );
}
