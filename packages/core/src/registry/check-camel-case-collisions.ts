import { camelFromKebab } from '../naming/camel-from-kebab.ts';
import type { AppSelection } from './app-selection.ts';
import { authorModules } from './author-modules.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/** `camelCaseCollisions`: two ids that camel-case to the same name cannot be selected together (section 5.1). */
export function checkCamelCaseCollisions(selection: AppSelection): readonly CompositionProblem[] {
  const byName = new Map<string, Set<string>>();
  for (const module of authorModules(selection)) {
    const name = camelFromKebab(module.id);
    byName.set(name, (byName.get(name) ?? new Set()).add(module.id));
  }
  return [...byName]
    .filter(([, ids]) => ids.size > 1)
    .map(([name, ids]) =>
      compositionError(
        'camelCaseCollisions',
        `Modules ${[...ids].map((id) => `'${id}'`).join(' and ')} are both '${name}' in a handler context.`,
        { ref: name },
      ),
    );
}
