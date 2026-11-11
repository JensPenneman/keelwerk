import type { AnyActionPart } from '../model/action-part.ts';
import type { ActionEntry } from './action-entry.ts';
import { actionEntryOf, type PartMount } from './action-entry-of.ts';
import type { AppliedPart } from './applied-part.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EntityModel } from './entity-model.ts';
import { generatedActionEntries } from './generated-action-entries.ts';
import type { RuntimeModule } from './runtime-module.ts';
import { shownOnceProblem } from './shown-once-problem.ts';

/** The action table and the problems met while filling it. */
export interface ActionTable {
  readonly actions: ReadonlyMap<string, ActionEntry>;
  readonly problems: readonly CompositionProblem[];
}

/**
 * Every action of the app by reference (section 16.2.2): the modules' own, the active contributions'
 * and conditional parts', the app's, and the generated ones of every entity. An action mounted
 * under a reference that is already taken is `duplicateActions`.
 */
export function buildActionTable(
  app: ComposableApp,
  ordered: readonly RuntimeModule[],
  parts: readonly AppliedPart[],
  entities: ReadonlyMap<string, EntityModel>,
): ActionTable {
  const actions = new Map<string, ActionEntry>();
  const problems: CompositionProblem[] = [];
  const effects = new Map<object, string>();
  for (const module of ordered) {
    for (const [name, part] of Object.entries(module.effects))
      effects.set(part, `${module.id}.${name}`);
  }
  const context = { app, entities, effects };
  const put = (entry: ActionEntry): void => {
    if (actions.has(entry.ref)) {
      problems.push(
        compositionError('duplicateActions', `The action '${entry.ref}' is mounted twice.`, {
          module: entry.module,
          ref: entry.ref,
        }),
      );
      return;
    }
    actions.set(entry.ref, entry);
    const shown = shownOnceProblem(entry);
    if (shown !== undefined) problems.push(shown);
  };
  const mount = (part: AnyActionPart, at: PartMount): void => {
    put(actionEntryOf(part, at, context));
  };
  for (const module of ordered) {
    for (const [name, part] of Object.entries(module.actions)) {
      mount(part, { ref: `${module.id}.${name}`, module: module.id, name, mount: 'module' });
    }
    for (const [entity, definition] of Object.entries(module.entities)) {
      for (const [name, part] of Object.entries(definition.actions)) {
        mount(part, {
          ref: `${module.id}.${entity}.${name}`,
          module: module.id,
          entity,
          name,
          mount: 'entity',
        });
      }
      const model = entities.get(`${module.id}.${entity}`);
      if (model !== undefined) {
        for (const entry of generatedActionEntries(model, app)) put(entry);
      }
    }
  }
  for (const part of parts) {
    if (!part.active) continue;
    for (const [name, action] of Object.entries(part.actions)) {
      mount(action, {
        ref: `${part.target}.${name}`,
        module: part.target,
        name,
        mount: 'module',
        contributedBy: part.declaredBy.id,
      });
    }
    for (const [entity, patch] of Object.entries(part.entities)) {
      for (const [name, action] of Object.entries(patch.actions)) {
        mount(action, {
          ref: `${part.target}.${entity}.${name}`,
          module: part.target,
          entity,
          name,
          mount: 'entity',
          contributedBy: part.declaredBy.id,
        });
      }
    }
  }
  for (const [name, part] of Object.entries(app.appActions)) {
    mount(part, { ref: `app.${name}`, module: 'app', name, mount: 'app' });
  }
  return { actions, problems };
}
