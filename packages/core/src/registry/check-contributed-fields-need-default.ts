import type { AnyField } from '../fields/field-def.ts';
import type { AppSelection } from './app-selection.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EntityPatchView, RuntimeModule } from './runtime-module.ts';

function unguarded(
  path: string,
  entities: { readonly [entity: string]: Pick<EntityPatchView, 'fields'> },
  module: RuntimeModule,
): readonly CompositionProblem[] {
  return Object.entries(entities).flatMap(([entity, patch]) =>
    Object.entries<AnyField>(patch.fields)
      .filter(([, def]) => !(def.flags.optional || def.flags.defaulted))
      .map(([name]) =>
        compositionError(
          'contributedFieldsNeedDefault',
          `${path}.${entity}.${name} is neither optional nor defaulted: rows are inserted while the part is inactive.`,
          { module: module.id, ref: `${path}.${entity}.${name}` },
        ),
      ),
  );
}

/** `contributedFieldsNeedDefault`: a contributed or conditional field is neither optional nor defaulted (case 10). */
export function checkContributedFieldsNeedDefault(
  selection: AppSelection,
): readonly CompositionProblem[] {
  return [...selection.byId.values()].flatMap((module) => [
    ...module.conditional.flatMap((conditional) =>
      unguarded(`${module.id}[${conditional.key}]`, conditional.entities, module),
    ),
    ...module.contributes.flatMap((contribution) =>
      unguarded(`${module.id}->${contribution.to.id}`, contribution.entities, module),
    ),
  ]);
}
