import type { EntityEntry } from '../registry/entity-entry.ts';
import { invalidArgument } from './invalid-argument.ts';

function readSortItem(
  item: unknown,
  index: number,
): { readonly field: string; readonly direction: 'asc' | 'desc' } {
  if (typeof item === 'string') {
    const descending = item.startsWith('-');
    return { field: descending ? item.slice(1) : item, direction: descending ? 'desc' : 'asc' };
  }
  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    const { field, direction } = item as { field?: unknown; direction?: unknown };
    if (
      typeof field === 'string' &&
      (direction === undefined || direction === 'asc' || direction === 'desc')
    ) {
      return { field, direction: direction ?? 'asc' };
    }
  }
  throw invalidArgument(
    `sort.${index}`,
    'A sort item is { field, direction? } or a field name, "-" for descending.',
  );
}

/** A sort as the generated `query` takes it. */
export type ReadSort = readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[];

/** The sort of section 16.4.4: a list of `{ field, direction? }` (direction defaults to `asc`) or field names with a leading `-` for descending; only fields in `page.sortable`; the entity's default when absent. */
export function readSort(value: unknown, entry: EntityEntry): ReadSort {
  if (value === undefined || value === null) return entry.page.defaultSort;
  if (!Array.isArray(value)) throw invalidArgument('sort', 'A sort must be a list.');
  return value.map((item, index) => {
    const { field, direction } = readSortItem(item, index);
    if (!entry.page.sortable.includes(field)) {
      throw invalidArgument(
        `sort.${index}`,
        `"${field}" is not a sortable field of "${entry.ref}".`,
      );
    }
    return { field, direction };
  });
}
