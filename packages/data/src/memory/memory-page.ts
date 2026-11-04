import type { Condition, EntityDescriptor, RowPage, RowQuery, StorageRow } from '@keelwerk/core';
import { compileSort } from '../sql/compile-sort.ts';
import { cursorSignature } from '../sql/cursor-signature.ts';
import { decodeCursor } from '../sql/decode-cursor.ts';
import { encodeCursor } from '../sql/encode-cursor.ts';
import { entityTable } from '../sql/entity-table.ts';
import { malformedQuery } from '../sql/malformed-query.ts';
import { windowOf } from '../sql/window-of.ts';
import { memoryCodecs } from './memory-codecs.ts';
import { memoryCompareRows } from './memory-compare-rows.ts';
import { memoryProjectRow } from './memory-project-row.ts';

const systemFields = ['id', 'createdAt', 'updatedAt', 'archivedAt', 'version'] as const;

/** The paging arguments of a row read. */
export interface MemoryPageRequest {
  readonly sort?: RowQuery['sort'];
  readonly page?: RowQuery['page'];
  readonly select?: RowQuery['select'];
  readonly total?: boolean;
  readonly where?: Condition;
  readonly maxOffset: number;
}

/**
 * Sorts, pages and projects candidate rows exactly as the compiled statement does
 * (`compileRowQuery`): keyset paging over the sort with `id` last, cursors that carry the
 * filter's signature (the same codec, so the families accept each other's cursors), position
 * windows, and the page info.
 */
export function memoryPage(
  entity: EntityDescriptor,
  candidates: readonly StorageRow[],
  request: MemoryPageRequest,
): RowPage {
  const table = entityTable(entity, null, 'e');
  const sort = compileSort(table, request.sort, memoryCodecs);
  const window = windowOf(request.page, request.maxOffset);
  const signature = cursorSignature(sort.keys, request.where);
  const cursorKeys = sort.keys.slice(0, -1);

  const names: string[] = [...systemFields];
  for (const name of request.select ?? Object.keys(entity.fields)) {
    if (!names.includes(name)) names.push(name);
  }
  for (const key of sort.keys) if (!names.includes(key.field)) names.push(key.field);
  for (const name of names) {
    if (table.column(name) === undefined)
      throw malformedQuery(`${entity.ref} has no field ${name}`);
  }

  const sorted = candidates.toSorted((a, b) => memoryCompareRows(sort.keys, a, b));
  let list = sorted;
  const cursor = window.after ?? window.before;
  if (cursor !== undefined) {
    const decoded = decodeCursor(
      cursor,
      cursorKeys.map((key) => key.column.field),
      signature,
    );
    const anchor: Record<string, unknown> = { id: decoded.id };
    cursorKeys.forEach((key, index) => {
      anchor[key.field] = decoded.values[index];
    });
    const after = window.after !== undefined;
    list = sorted.filter((row) => {
      const sign = memoryCompareRows(sort.keys, row, anchor);
      return after ? sign > 0 : sign < 0;
    });
  }
  const ordered = window.backwards ? list.toReversed() : list;
  const fetched =
    window.limit === undefined
      ? ordered.slice(window.offset)
      : ordered.slice(window.offset, window.offset + window.limit);
  const overflow = window.size !== undefined && fetched.length > window.size;
  const kept = window.size === undefined ? fetched : fetched.slice(0, window.size);
  const rows = (window.backwards ? kept.toReversed() : kept).map((row) =>
    memoryProjectRow(row, names),
  );
  const cursorOf = (row: StorageRow): string =>
    encodeCursor(
      cursorKeys.map((key) => row[key.field] ?? null),
      String(row.id),
      signature,
    );
  const first = rows.at(0);
  const last = rows.at(-1);
  const forward = !window.backwards;
  return {
    rows,
    pageInfo: {
      hasNextPage: forward ? overflow : window.before !== undefined || window.offset > 0,
      hasPreviousPage: forward ? window.after !== undefined || window.offset > 0 : overflow,
      startCursor: first === undefined ? null : cursorOf(first),
      endCursor: last === undefined ? null : cursorOf(last),
    },
    ...(request.total === true ? { total: sorted.length } : {}),
  };
}
