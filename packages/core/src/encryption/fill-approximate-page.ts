import { errors } from '../errors/errors.ts';
import type { RowPage } from '../storage/row-page.ts';
import type { RowQuery } from '../storage/row-query.ts';
import type { StorageRow } from '../storage/storage-row.ts';

/** How many rows are examined, in pages of the size asked for, before a page of an approximate plan gives up filling (14.7.9.5). */
const examinedFactor = 10;

/**
 * A page of a query whose tags are truncated (14.7.9.5 step 4): the database result holds false
 * matches, so one raw page comes back short. Raw pages are read, each only as large as the rows
 * still missing, and kept as far as `settle` confirms them, until the page is full or ten times
 * its size has been examined; the end cursor is the one after the last examined row.
 */
export async function fillApproximatePage(
  want: number,
  query: RowQuery,
  readRaw: (page: NonNullable<RowQuery['page']>) => Promise<RowPage>,
  settle: (rows: readonly StorageRow[]) => Promise<readonly StorageRow[]>,
): Promise<RowPage> {
  const kept: StorageRow[] = [];
  let examined = 0;
  let after = query.page !== undefined && 'after' in query.page ? query.page.after : undefined;
  let first: RowPage | undefined;
  let last: RowPage | undefined;
  while (kept.length < want && examined < want * examinedFactor) {
    const raw = await readRaw({
      first: want - kept.length,
      ...(after === undefined ? {} : { after }),
    });
    first ??= raw;
    last = raw;
    examined += raw.rows.length;
    kept.push(...(await settle(raw.rows)));
    if (!raw.pageInfo.hasNextPage || raw.pageInfo.endCursor === null) break;
    after = raw.pageInfo.endCursor;
  }
  if (first === undefined || last === undefined) throw errors.internal('A page fill read no page.');
  return {
    rows: kept,
    pageInfo: {
      hasNextPage: last.pageInfo.hasNextPage,
      hasPreviousPage: first.pageInfo.hasPreviousPage,
      startCursor: first.pageInfo.startCursor,
      endCursor: last.pageInfo.endCursor,
    },
    ...(first.position === undefined ? {} : { position: first.position }),
  };
}
