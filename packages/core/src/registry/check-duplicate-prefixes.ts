import type { AppSelection } from './app-selection.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/** `duplicatePrefixes`: TypeID prefixes are unique per app (section 5.1). */
export function checkDuplicatePrefixes(selection: AppSelection): readonly CompositionProblem[] {
  const owners = new Map<string, string[]>();
  for (const module of selection.byId.values()) {
    for (const [name, entity] of Object.entries(module.entities)) {
      owners.set(entity.prefix, [...(owners.get(entity.prefix) ?? []), `${module.id}.${name}`]);
    }
  }
  return [...owners]
    .filter(([, refs]) => refs.length > 1)
    .map(([prefix, refs]) =>
      compositionError(
        'duplicatePrefixes',
        `The TypeID prefix '${prefix}' is used by ${refs.join(' and ')}.`,
        { ref: prefix },
      ),
    );
}
