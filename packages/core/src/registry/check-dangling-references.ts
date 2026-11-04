import type { AnyField } from '../fields/field-def.ts';
import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { entitySources } from './entity-sources.ts';
import { referenceTarget } from './reference-target.ts';

function targetPresent(selection: AppSelection, module: string, entity: string): boolean {
  const found = selection.byId.get(module);
  return found !== undefined && Object.hasOwn(found.entities, entity);
}

/** `danglingReferences`: an active reference whose target module or entity is not selected (a backstop for `refsOutsideRequirements`). */
export function checkDanglingReferences(
  selection: AppSelection,
  parts: readonly AppliedPart[],
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const module of selection.byId.values()) {
    for (const entity of Object.keys(module.entities)) {
      for (const source of entitySources(module, entity, parts)) {
        const found: [string, string, string][] = [];
        for (const [name, def] of Object.entries<AnyField>(source.fields)) {
          const target = referenceTarget(def.ref, source.declaredBy);
          if (target !== null) found.push([name, target.module, target.entity]);
        }
        for (const [name, relation] of Object.entries(source.relations)) {
          const target = referenceTarget(relation.target, source.declaredBy);
          if (target !== null) found.push([name, target.module, target.entity]);
        }
        for (const [name, targetModule, targetEntity] of found) {
          if (!targetPresent(selection, targetModule, targetEntity)) {
            problems.push(
              compositionError(
                'danglingReferences',
                `${module.id}.${entity}.${name} -> ${targetModule}.${targetEntity}: the target is not selected.`,
                { module: module.id, ref: `${module.id}.${entity}.${name}` },
              ),
            );
          }
        }
      }
    }
  }
  return problems;
}
