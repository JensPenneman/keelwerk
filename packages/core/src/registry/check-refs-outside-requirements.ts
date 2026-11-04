import type { AnyField } from '../fields/field-def.ts';
import type { Dependency } from '../model/any-module.ts';
import type { AppSelection } from './app-selection.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { dependencyName } from './dependency-name.ts';
import type { EntityPatchView, RuntimeModule } from './runtime-module.ts';

function moduleIds(dependencies: readonly Dependency[]): readonly string[] {
  return dependencies.filter((dependency) => dependency.kind === 'module').map(dependencyName);
}

/**
 * `refsOutsideRequirements`: a reference targets a module outside `requires`, or, inside a
 * contribution or conditional part, outside its target and `when` modules (case 9).
 */
export function checkRefsOutsideRequirements(
  selection: AppSelection,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const module of selection.byId.values()) {
    const required = moduleIds(module.requires);
    const scan = (
      path: string,
      entities: { readonly [entity: string]: Pick<EntityPatchView, 'fields'> },
      allowed: readonly string[],
      owner: RuntimeModule,
    ): void => {
      for (const [entity, patch] of Object.entries(entities)) {
        for (const [name, def] of Object.entries<AnyField>(patch.fields)) {
          const target = def.ref;
          if (target === null || 'own' in target || allowed.includes(target.module)) continue;
          problems.push(
            compositionError(
              'refsOutsideRequirements',
              `${path}.${entity}.${name} -> ${target.module}: '${target.module}' is not listed in 'requires'.`,
              { module: owner.id, ref: `${path}.${entity}.${name}` },
            ),
          );
        }
      }
    };
    scan(module.id, module.entities, required, module);
    for (const conditional of module.conditional) {
      scan(
        `${module.id}[${conditional.key}]`,
        conditional.entities,
        [...required, ...moduleIds(conditional.when)],
        module,
      );
    }
    for (const contribution of module.contributes) {
      scan(
        `${module.id}->${contribution.to.id}`,
        contribution.entities,
        [...required, contribution.to.id, ...moduleIds(contribution.when)],
        module,
      );
    }
  }
  return problems;
}
