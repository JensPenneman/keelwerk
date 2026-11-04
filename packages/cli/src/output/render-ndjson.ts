import { pageItems } from './page-items.ts';

/** One JSON document per line: the rows of a page or array, otherwise the value itself. */
export function renderNdjson(value: unknown): string {
  const items = pageItems(value) ?? [value];
  return items.map((item) => JSON.stringify(item)).join('\n');
}
