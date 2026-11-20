import type { StorageRow } from '@keelwerk/core';
import { canonicalizeJson } from '@keelwerk/core';

function plain(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Set) return [...value].sort();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64url');
  return value;
}

/** Rows as comparable text, ordered by id: instants as text, bigints as decimal text, sets sorted, members in canonical order. */
export function rowsAsText(rows: readonly StorageRow[]): readonly string[] {
  return [...rows]
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
    .map((row) => canonicalizeJson(JSON.parse(JSON.stringify(row, plain)) as unknown));
}
