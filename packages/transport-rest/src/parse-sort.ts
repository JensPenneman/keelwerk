/** One sort key of the wire form (section 16.4.4). */
export interface SortKey {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

/** The compact `sort=displayName,-createdAt` form: a leading `-` means descending. Undefined when a key is empty. */
export function parseSort(text: string): readonly SortKey[] | undefined {
  const keys: SortKey[] = [];
  for (const part of text.split(',')) {
    const descending = part.startsWith('-');
    const field = descending ? part.slice(1) : part;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(field)) {
      return undefined;
    }
    keys.push({ field, direction: descending ? 'desc' : 'asc' });
  }
  return keys;
}
