import type { AnyField } from '../fields/field-def.ts';
import type { EntityEntry } from './entity-entry.ts';

/**
 * The paging defaults of an entity (section 6.7): sorts by `id`, `createdAt`, `updatedAt` and
 * indexed or unique fields (a personal field only with the `order` capability), 50 rows by default,
 * 500 at most.
 */
export function entityPage(fields: Readonly<Record<string, AnyField>>): EntityEntry['page'] {
  const sortable = Object.entries(fields)
    .filter(
      ([, def]) =>
        (def.flags.unique || def.flags.indexed) &&
        (def.flags.personal === false || def.flags.personal.queries.includes('order')),
    )
    .map(([name]) => name);
  return {
    sortable: ['id', 'createdAt', 'updatedAt', ...sortable],
    defaultSort: [{ field: 'id', direction: 'asc' }],
    defaultSize: 50,
    maxSize: 500,
  };
}
