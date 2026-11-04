import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import { authorModules } from './author-modules.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

const reservedModuleIds: ReadonlySet<string> = new Set(['core', 'app']);
const generatedActionNames: ReadonlySet<string> = new Set([
  'get',
  'query',
  'changes',
  'queryChanges',
  'set',
  'create',
  'update',
  'archive',
  'restore',
  'watch',
  'history',
]);
const generatedEventNames: ReadonlySet<string> = new Set([
  'created',
  'changed',
  'archived',
  'restored',
  'erased',
  'snapshot',
  'imported',
]);
const operatorNames: ReadonlySet<string> = new Set(['and', 'or', 'not']);

/**
 * `reservedModuleIds` (case 8) and the reserved names of section 5.1: generated action names as
 * entity action names, generated event names as domain events, and the filter operators as fields.
 */
export function checkReservedNames(
  selection: AppSelection,
  parts: readonly AppliedPart[],
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const module of authorModules(selection)) {
    if (reservedModuleIds.has(module.id)) {
      problems.push(
        compositionError('reservedModuleIds', `'${module.id}' is a reserved module id.`, {
          module: module.id,
          ref: module.id,
        }),
      );
    }
  }
  for (const module of selection.byId.values()) {
    for (const [entity, definition] of Object.entries(module.entities)) {
      const at = `${module.id}.${entity}`;
      const flag = (code: string, name: string, what: string): void => {
        problems.push(
          compositionError(code, `'${name}' is reserved and cannot name ${what} of ${at}.`, {
            module: module.id,
            ref: at,
          }),
        );
      };
      for (const name of Object.keys(definition.actions)) {
        if (generatedActionNames.has(name)) flag('reservedActionNames', name, 'an action');
      }
      for (const name of Object.keys(definition.events)) {
        if (generatedEventNames.has(name)) flag('reservedEventNames', name, 'an event');
      }
      for (const name of [
        ...Object.keys(definition.fields),
        ...Object.keys(definition.relations),
      ]) {
        if (operatorNames.has(name)) flag('reservedFieldNames', name, 'a field or relation');
      }
    }
  }
  for (const part of parts) {
    for (const [entity, patch] of Object.entries(part.entities)) {
      const at = `${part.target}.${entity}`;
      for (const name of Object.keys(patch.actions)) {
        if (generatedActionNames.has(name)) {
          problems.push(
            compositionError(
              'reservedActionNames',
              `'${name}' is reserved and cannot name an action of ${at}.`,
              {
                module: part.declaredBy.id,
                ref: at,
              },
            ),
          );
        }
      }
      for (const name of [...Object.keys(patch.fields), ...Object.keys(patch.relations)]) {
        if (operatorNames.has(name)) {
          problems.push(
            compositionError(
              'reservedFieldNames',
              `'${name}' is reserved and cannot name a field or relation of ${at}.`,
              {
                module: part.declaredBy.id,
                ref: at,
              },
            ),
          );
        }
      }
    }
  }
  return problems;
}
