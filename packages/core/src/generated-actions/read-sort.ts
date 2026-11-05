import type { EntityEntry } from '../registry/entity-entry.ts';
import { invalidArgument } from './invalid-argument.ts';

/** A sort as the generated `query` takes it. */
export type ReadSort = readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[];

/** The sort of section 16.4.4: a list of field names, a leading `-` for descending; only fields in `page.sortable`; the entity's default when absent. */
export function readSort(value: unknown, entry: EntityEntry): ReadSort {
  if (value === undefined || value === null) return entry.page.defaultSort;
  if (!Array.isArray(value)) throw invalidArgument('sort', 'A sort must be a list.');
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw invalidArgument(`sort.${index}`, 'A sort item is a field name, "-" for descending.');
    }
    const descending = item.startsWith('-');
    const field = descending ? item.slice(1) : item;
    if (!entry.page.sortable.includes(field)) {
      throw invalidArgument(
        `sort.${index}`,
        `"${field}" is not a sortable field of "${entry.ref}".`,
      );
    }
    return { field, direction: descending ? 'desc' : 'asc' };
  });
}
