import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { namePattern } from './name-pattern.ts';

const idPattern = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/;

/**
 * The identifier grammar of section 5.1: module and app ids are words separated by single hyphens
 * (`invalidModuleIds`, `invalidAppId`); entity and field names match `[a-z][a-zA-Z0-9]*`
 * (`invalidEntityName` and `invalidFieldName` as the DSL raises them); action, relation and event
 * names have checks of their own.
 */
export function checkIdentifierGrammar(
  app: ComposableApp,
  selection: AppSelection,
  parts: readonly AppliedPart[],
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  if (!idPattern.test(app.id)) {
    problems.push(
      compositionError('invalidAppId', `App id '${app.id}' does not match ${idPattern}.`, {
        ref: app.id,
      }),
    );
  }
  const badName = (name: string, at: string, module: string, code: string): void => {
    if (!namePattern.test(name)) {
      problems.push(
        compositionError(code, `'${name}' (${at}) does not match ${namePattern}.`, {
          module,
          ref: at,
        }),
      );
    }
  };
  for (const module of selection.byId.values()) {
    if (!idPattern.test(module.id)) {
      problems.push(
        compositionError(
          'invalidModuleIds',
          `Module id '${module.id}' does not match ${idPattern}.`,
          {
            module: module.id,
            ref: module.id,
          },
        ),
      );
    }
    for (const [entity, definition] of Object.entries(module.entities)) {
      const at = `${module.id}.${entity}`;
      badName(entity, at, module.id, 'invalidEntityName');
      for (const name of Object.keys(definition.fields)) {
        badName(name, `${at}.${name}`, module.id, 'invalidFieldName');
      }
    }
  }
  for (const part of parts) {
    for (const [entity, patch] of Object.entries(part.entities)) {
      for (const name of Object.keys(patch.fields)) {
        badName(name, `${part.target}.${entity}.${name}`, part.declaredBy.id, 'invalidFieldName');
      }
    }
  }
  return problems;
}
