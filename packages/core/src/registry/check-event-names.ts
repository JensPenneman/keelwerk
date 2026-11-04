import type { AppSelection } from './app-selection.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { namePattern } from './name-pattern.ts';

/** `invalidEventName` (section 5.1): entity event names match `[a-z][a-zA-Z0-9]*`. */
export function checkEventNames(selection: AppSelection): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const module of selection.byId.values()) {
    for (const [entity, definition] of Object.entries(module.entities)) {
      for (const name of Object.keys(definition.events)) {
        const at = `${module.id}.${entity}.${name}`;
        if (namePattern.test(name)) continue;
        problems.push(
          compositionError('invalidEventName', `'${name}' (${at}) does not match ${namePattern}.`, {
            module: module.id,
            ref: at,
          }),
        );
      }
    }
  }
  return problems;
}
