import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';

/**
 * The framework columns a read of a table does not return (they are written, never selected): the
 * chain tail. A row read back cannot show them, so a comparison leaves them out. The erasure instant
 * `kwErasedAt` is returned by a read that includes erased rows, so it is compared.
 */
const unreadColumns: ReadonlySet<string> = new Set(['kwLastHlc', 'kwLastHash']);

/**
 * A row as comparable data: every value in its payload form (an instant as text, a bigint as
 * decimal text, bytes as base64url), the members of a set in sorted order, an absent value and
 * a null alike left out, and the columns a read does not return left out. A row folded from
 * events and the row its table holds are equal exactly when they hold the same values.
 */
export function comparableRow(row: StorageRow): Record<string, unknown> {
  const comparable: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    if (value === undefined || value === null || unreadColumns.has(name)) continue;
    comparable[name] =
      value instanceof Set
        ? [...value].map(encodeEventValue).sort((a, b) => {
            const [left, right] = [canonicalizeJson(a), canonicalizeJson(b)];
            return left < right ? -1 : left > right ? 1 : 0;
          })
        : encodeEventValue(value);
  }
  return comparable;
}
