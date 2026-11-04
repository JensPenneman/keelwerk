import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { namePattern } from './name-pattern.ts';

/** `invalidRelationName` (section 5.1): relation names, own and contributed, match `[a-z][a-zA-Z0-9]*`. */
export function checkRelationNames(
  selection: AppSelection,
  parts: readonly AppliedPart[],
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  const check = (name: string, at: string, module: string): void => {
    if (namePattern.test(name)) return;
    problems.push(
      compositionError('invalidRelationName', `'${name}' (${at}) does not match ${namePattern}.`, {
        module,
        ref: at,
      }),
    );
  };
  for (const module of selection.byId.values()) {
    for (const [entity, definition] of Object.entries(module.entities)) {
      for (const name of Object.keys(definition.relations)) {
        check(name, `${module.id}.${entity}.${name}`, module.id);
      }
    }
  }
  for (const part of parts) {
    for (const [entity, patch] of Object.entries(part.entities)) {
      for (const name of Object.keys(patch.relations)) {
        check(name, `${part.target}.${entity}.${name}`, part.declaredBy.id);
      }
    }
  }
  return problems;
}
