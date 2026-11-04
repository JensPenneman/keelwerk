import type { AnyErrorDefinition } from '../errors/error-definition.ts';
import type { AnyActionPart } from '../model/action-part.ts';
import { specOf } from '../registry/action-spec-view.ts';
import type { AppliedPart } from '../registry/applied-part.ts';
import type { ComposableApp } from '../registry/composable-app.ts';
import { compositionError } from '../registry/composition-error.ts';
import type { CompositionProblem } from '../registry/composition-problem.ts';
import type { RuntimeModule } from '../registry/runtime-module.ts';

function sameDefinition(left: AnyErrorDefinition, right: AnyErrorDefinition): boolean {
  return (
    left === right ||
    (left.spec.kind === right.spec.kind &&
      left.spec.message === right.spec.message &&
      left.spec.data === right.spec.data)
  );
}

/** The declared error definitions by code and the problems met collecting them. */
export interface DeclaredErrors {
  readonly errors: ReadonlyMap<string, AnyErrorDefinition>;
  readonly problems: readonly CompositionProblem[];
}

/**
 * The error definitions the actions of an app declare, by code: modules' own actions, the active
 * contributions' and conditional parts', and the app's. The registry keeps the codes only, and the
 * surface needs each error's kind, message and data schema. The first definition of a code wins,
 * and a later definition of the same code with another kind, message or data schema is a
 * `conflictingErrors` problem, so the choice never depends on the module tuple silently.
 */
export function declaredErrorsOf(
  app: ComposableApp,
  ordered: readonly RuntimeModule[],
  parts: readonly AppliedPart[],
): DeclaredErrors {
  const actions: AnyActionPart[] = [];
  for (const module of ordered) {
    actions.push(...Object.values(module.actions));
    for (const entity of Object.values(module.entities))
      actions.push(...Object.values(entity.actions));
  }
  for (const part of parts) {
    if (!part.active) continue;
    actions.push(...Object.values(part.actions));
    for (const patch of Object.values(part.entities)) actions.push(...Object.values(patch.actions));
  }
  actions.push(...Object.values(app.appActions));
  const found = new Map<string, AnyErrorDefinition>();
  const problems: CompositionProblem[] = [];
  const reported = new Set<string>();
  for (const action of actions) {
    for (const definition of specOf(action).errors ?? []) {
      const known = found.get(definition.code);
      if (known === undefined) {
        found.set(definition.code, definition);
      } else if (!sameDefinition(known, definition) && !reported.has(definition.code)) {
        reported.add(definition.code);
        problems.push(
          compositionError(
            'conflictingErrors',
            `The error '${definition.code}' is defined twice with another kind, message or data schema.`,
            { ref: definition.code },
          ),
        );
      }
    }
  }
  return { errors: found, problems };
}
