import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';

const pageSize = 500;

/**
 * Every row of the entity in the unit's scope, archived ones included, in id order, 500 a page.
 * With `includeErased` the tombstones of erased rows are read too, `kwErasedAt` among their columns.
 */
export async function currentRows(
  unit: Unit,
  entry: EntityEntry,
  includeErased = false,
): Promise<StorageRow[]> {
  const rows: StorageRow[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await unit.rows.find(entry.descriptor, {
      sort: [{ field: 'id', direction: 'asc' }],
      page: { first: pageSize, ...(after === undefined ? {} : { after }) },
      includeArchived: true,
      ...(includeErased ? { includeErased: true } : {}),
    });
    rows.push(...page.rows);
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return rows;
    after = page.pageInfo.endCursor;
  }
}
