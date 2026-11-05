import { compareCodePoints } from '../conditions/compare-code-points.ts';
import { errors } from '../errors/errors.ts';
import { compareSortValues } from '../replay/compare-sort-values.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { RowPage } from '../storage/row-page.ts';
import type { RowQuery } from '../storage/row-query.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { PlannedCondition } from './planned-condition.ts';
import { projectRow } from './project-row.ts';
import { scanSelected } from './scan-selected.ts';
import type { SealingContext } from './sealing-context.ts';

/**
 * A page of a bounded scan (S-37): the candidates the rest of the condition selects, unsealed,
 * filtered, sorted (id last) and paged in memory. The cursor is the id of the last row of the
 * page; a scan pages forward by `first` and `after` only.
 */
export async function scanFind(
  context: SealingContext,
  entity: EntityDescriptor,
  query: RowQuery,
  plan: PlannedCondition,
): Promise<RowPage> {
  const page = query.page;
  if (
    page !== undefined &&
    ('position' in page || page.before !== undefined || page.last !== undefined)
  ) {
    throw errors.unsupported('A scan pages forward by first and after only.');
  }
  const { rows, position } = await scanSelected(context, entity, query, plan);
  const keys = [...(query.sort ?? [])];
  if (!keys.some((key) => key.field === 'id')) keys.push({ field: 'id', direction: 'asc' });
  const kindOf = (field: string) => entity.fields[field]?.kind;
  const sorted = rows.toSorted((a, b) => {
    for (const key of keys) {
      const sign =
        key.field === 'id'
          ? compareCodePoints(String(a.id), String(b.id))
          : compareSortValues(a[key.field], b[key.field], kindOf(key.field));
      if (sign !== 0) return key.direction === 'asc' ? sign : -sign;
    }
    return 0;
  });
  let start = 0;
  if (page?.after !== undefined) {
    const at = sorted.findIndex((row) => String(row.id) === page.after);
    if (at < 0) throw errors.validation('The cursor does not belong to this scan.');
    start = at + 1;
  }
  const end =
    page?.first === undefined ? sorted.length : Math.min(sorted.length, start + page.first);
  const kept = sorted.slice(start, end);
  const edge = (row: StorageRow | undefined): string | null =>
    row === undefined ? null : String(row.id);
  const select = query.select;
  return {
    rows: select === undefined ? kept : kept.map((row) => projectRow(row, select)),
    pageInfo: {
      hasNextPage: end < sorted.length,
      hasPreviousPage: start > 0,
      startCursor: edge(kept.at(0)),
      endCursor: edge(kept.at(-1)),
    },
    ...(query.total === true ? { total: sorted.length } : {}),
    ...(position === undefined ? {} : { position }),
  };
}
