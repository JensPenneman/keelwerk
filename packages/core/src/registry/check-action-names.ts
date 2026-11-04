import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { namePattern } from './name-pattern.ts';

/**
 * `invalidActionName` (section 5.1): the names of module, entity, contributed and app actions
 * match `[a-z][a-zA-Z0-9]*`.
 */
export function checkActionNames(
  app: ComposableApp,
  selection: AppSelection,
  parts: readonly AppliedPart[],
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  const check = (name: string, at: string, module: string): void => {
    if (namePattern.test(name)) return;
    problems.push(
      compositionError('invalidActionName', `'${name}' (${at}) does not match ${namePattern}.`, {
        module,
        ref: at,
      }),
    );
  };
  for (const module of selection.byId.values()) {
    for (const [entity, definition] of Object.entries(module.entities)) {
      for (const name of Object.keys(definition.actions)) {
        check(name, `${module.id}.${entity}.${name}`, module.id);
      }
    }
    for (const name of Object.keys(module.actions)) check(name, `${module.id}.${name}`, module.id);
  }
  for (const part of parts) {
    for (const name of Object.keys(part.actions)) {
      check(name, `${part.target}.${name}`, part.declaredBy.id);
    }
    for (const [entity, patch] of Object.entries(part.entities)) {
      for (const name of Object.keys(patch.actions)) {
        check(name, `${part.target}.${entity}.${name}`, part.declaredBy.id);
      }
    }
  }
  for (const name of Object.keys(app.appActions)) check(name, `app.${name}`, 'app');
  return problems;
}
