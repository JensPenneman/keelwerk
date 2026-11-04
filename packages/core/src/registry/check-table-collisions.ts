import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { EntityModel } from './entity-model.ts';

/** `tableCollisions`: two entities whose physical table names are equal after truncation (section 14.4.2). */
export function checkTableCollisions(
  entities: ReadonlyMap<string, EntityModel>,
): readonly CompositionProblem[] {
  const owners = new Map<string, string[]>();
  for (const { entry } of entities.values()) {
    const table = entry.descriptor.table;
    owners.set(table, [...(owners.get(table) ?? []), entry.ref]);
  }
  return [...owners]
    .filter(([, refs]) => refs.length > 1)
    .map(([table, refs]) =>
      compositionError('tableCollisions', `${refs.join(' and ')} share the table '${table}'.`, {
        ref: table,
      }),
    );
}
