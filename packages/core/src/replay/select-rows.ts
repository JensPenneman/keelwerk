import { compareCodePoints } from '../conditions/compare-code-points.ts';
import { evaluateCondition } from '../conditions/evaluate-condition.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { RowPage } from '../storage/row-page.ts';
import type { RowQuery } from '../storage/row-query.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { compareSortValues } from './compare-sort-values.ts';
import { replayUnsupported } from './replay-unsupported.ts';

/**
 * Filters, sorts and pages rows already read as of a position the way a row read does: the
 * condition, archived rows out unless asked for, the sort with `id` last, and the first `n`
 * rows. Cursors, position windows and relation quantifiers are not part of an as-of read.
 */
export function selectRows(
  descriptor: EntityDescriptor,
  rows: readonly StorageRow[],
  query: RowQuery,
): RowPage {
  const page = query.page;
  if (page !== undefined && ('position' in page || page.after !== undefined)) {
    throw replayUnsupported('An as-of read pages by `first` only.');
  }
  if (page !== undefined && (page.before !== undefined || page.last !== undefined)) {
    throw replayUnsupported('An as-of read pages by `first` only.');
  }
  const kindOf = (field: string) => descriptor.fields[field]?.kind;
  const where = query.where;
  const candidates = rows.filter(
    (row) =>
      (query.includeArchived === true || row.archivedAt === undefined || row.archivedAt === null) &&
      (where === undefined ||
        evaluateCondition(where, row, {
          kindOf,
          matching: () => {
            throw replayUnsupported('An as-of read does not evaluate relation conditions.');
          },
        })),
  );
  const keys = [...(query.sort ?? [])];
  if (!keys.some((key) => key.field === 'id')) keys.push({ field: 'id', direction: 'asc' });
  const sorted = candidates.toSorted((a, b) => {
    for (const key of keys) {
      const sign =
        key.field === 'id'
          ? compareCodePoints(String(a.id), String(b.id))
          : compareSortValues(a[key.field], b[key.field], kindOf(key.field));
      if (sign !== 0) return key.direction === 'asc' ? sign : -sign;
    }
    return 0;
  });
  const first = page?.first;
  const kept = first === undefined ? sorted : sorted.slice(0, first);
  const edge = (row: StorageRow | undefined) => (row === undefined ? null : String(row.id));
  return {
    rows: kept,
    pageInfo: {
      hasNextPage: kept.length < sorted.length,
      hasPreviousPage: false,
      startCursor: edge(kept.at(0)),
      endCursor: edge(kept.at(-1)),
    },
    ...(query.total === true ? { total: sorted.length } : {}),
  };
}
