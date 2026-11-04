import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { entitySources } from './entity-sources.ts';

/** `conflictingFields`: a field or relation has more than one source, whatever the types (case 6). */
export function checkConflictingFields(
  selection: AppSelection,
  parts: readonly AppliedPart[],
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const module of selection.byId.values()) {
    for (const entity of Object.keys(module.entities)) {
      const sourcesOf = new Map<string, number>();
      for (const source of entitySources(module, entity, parts)) {
        for (const name of new Set([
          ...Object.keys(source.fields),
          ...Object.keys(source.relations),
        ])) {
          sourcesOf.set(name, (sourcesOf.get(name) ?? 0) + 1);
        }
      }
      for (const [name, count] of sourcesOf) {
        if (count > 1) {
          problems.push(
            compositionError(
              'conflictingFields',
              `'${module.id}.${entity}.${name}' is defined by ${count} sources.`,
              { module: module.id, ref: `${module.id}.${entity}.${name}` },
            ),
          );
        }
      }
    }
  }
  return problems;
}
