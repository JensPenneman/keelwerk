/** The rows of a `Page<T>` (`{ items, pageInfo }`) or of a plain array; `undefined` for anything else. */
export function pageItems(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'object' && value !== null && 'items' in value) {
    const items = (value as { readonly items: unknown }).items;
    return Array.isArray(items) ? items : undefined;
  }
  return undefined;
}
