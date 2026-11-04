import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import { authorModules } from './author-modules.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/**
 * `duplicateModuleIds`: two modules share an id (case 8). Also `duplicateNames`: within one module,
 * entity names and module-level action names share a namespace, contributed actions included (5.1),
 * and a contribution cannot replace an action (5.3).
 */
export function checkDuplicateIds(
  selection: AppSelection,
  parts: readonly AppliedPart[],
): readonly CompositionProblem[] {
  const seen = new Set<string>();
  const problems: CompositionProblem[] = [];
  for (const module of authorModules(selection)) {
    if (seen.has(module.id)) {
      problems.push(
        compositionError('duplicateModuleIds', `Module id '${module.id}' is listed twice.`, {
          module: module.id,
          ref: module.id,
        }),
      );
    }
    seen.add(module.id);
  }
  for (const module of selection.byId.values()) {
    const names = new Map<string, number>();
    const add = (name: string): void => {
      names.set(name, (names.get(name) ?? 0) + 1);
    };
    for (const name of Object.keys(module.entities)) add(name);
    for (const name of Object.keys(module.actions)) add(name);
    for (const part of parts) {
      if (part.active && part.target === module.id) {
        for (const name of Object.keys(part.actions)) add(name);
      }
    }
    for (const [name, count] of names) {
      if (count > 1) {
        problems.push(
          compositionError(
            'duplicateNames',
            `'${module.id}.${name}' names more than one entity or module-level action.`,
            { module: module.id, ref: `${module.id}.${name}` },
          ),
        );
      }
    }
  }
  return problems;
}
