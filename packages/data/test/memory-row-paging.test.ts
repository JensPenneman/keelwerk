import type { StorageRow } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { cursorSignature } from '../src/sql/cursor-signature.ts';
import { decodeCursor } from '../src/sql/decode-cursor.ts';
import { failure } from './support/failure.ts';
import { id } from './support/id.ts';
import { openMemory } from './support/memory-fixture.ts';
import { note } from './support/note.ts';
import { noteRow } from './support/note-row.ts';
import { tenantScope } from './support/tenant-scope.ts';

const titles = (rows: readonly StorageRow[]): unknown[] => rows.map((row) => row.title);

async function seedNotes(
  memory: ReturnType<typeof openMemory>,
  rows: readonly StorageRow[],
): Promise<void> {
  await memory.run(tenantScope, (unit) => unit.rows.insert(note, rows));
}

describe('sorting and keyset paging', () => {
  const rows = (): StorageRow[] => [
    noteRow(1, { title: 'b', count: 2 }),
    noteRow(2, { title: 'a', count: 3 }),
    noteRow(3, { count: 1 }),
    noteRow(4, { title: 'c', count: 3 }),
  ];

  test('absent values sort last ascending and first descending, ties by id', async () => {
    const memory = openMemory();
    await seedNotes(memory, rows());
    const sorted = (direction: 'asc' | 'desc'): Promise<unknown[]> =>
      memory.read(tenantScope, async (unit) =>
        titles((await unit.rows.find(note, { sort: [{ field: 'title', direction }] })).rows),
      );
    expect(await sorted('asc')).toEqual(['a', 'b', 'c', undefined]);
    expect(await sorted('desc')).toEqual([undefined, 'c', 'b', 'a']);
    const ids = await memory.read(tenantScope, async (unit) =>
      (await unit.rows.find(note, { sort: [{ field: 'count', direction: 'desc' }] })).rows.map(
        (row) => row.id,
      ),
    );
    expect(ids).toEqual([id(2), id(4), id(1), id(3)]);
  });

  test('first and after walk the whole set, last and before walk it back', async () => {
    const memory = openMemory();
    await seedNotes(memory, rows());
    const sort = [{ field: 'count', direction: 'asc' }] as const;
    const walk = await memory.read(tenantScope, async (unit) => {
      const seen: unknown[] = [];
      let after: string | undefined;
      for (;;) {
        const page = await unit.rows.find(note, {
          sort,
          page: after === undefined ? { first: 3 } : { first: 3, after },
        });
        seen.push(page.rows.map((row) => row.count));
        if (!page.pageInfo.hasNextPage) return seen;
        after = page.pageInfo.endCursor ?? undefined;
      }
    });
    expect(walk).toEqual([[1, 2, 3], [3]]);
    const back = await memory.read(tenantScope, async (unit) => {
      const tail = await unit.rows.find(note, { sort, page: { last: 3 } });
      const head = await unit.rows.find(note, {
        sort,
        page: { last: 3, before: tail.pageInfo.startCursor ?? '' },
      });
      return [
        tail.rows.map((row) => row.count),
        tail.pageInfo.hasPreviousPage,
        head.rows.map((row) => row.count),
        head.pageInfo.hasNextPage,
      ];
    });
    expect(back).toEqual([[2, 3, 3], true, [1], true]);
  });

  test('a cursor belongs to its sort and filter, and decodes with the shared codec', async () => {
    const memory = openMemory();
    await seedNotes(memory, rows());
    const sort = [{ field: 'title', direction: 'asc' }] as const;
    const page = await memory.read(tenantScope, (unit) =>
      unit.rows.find(note, { sort, page: { first: 1 } }),
    );
    const cursor = page.pageInfo.endCursor ?? '';
    const keys = [...sort, { field: 'id', direction: 'asc' as const }];
    const decoded = decodeCursor(
      cursor,
      [note.fields.title as never],
      cursorSignature(keys, undefined),
    );
    expect(decoded).toEqual({ values: ['a'], id: id(2) });
    const other = await failure(
      memory.read(tenantScope, (unit) =>
        unit.rows.find(note, {
          sort: [{ field: 'count', direction: 'asc' }],
          page: { first: 1, after: cursor },
        }),
      ),
    );
    expect(other.code).toBe('core.cursor_mismatch');
  });

  test('total counts the filter, not the page', async () => {
    const memory = openMemory();
    await seedNotes(memory, rows());
    const page = await memory.read(tenantScope, (unit) =>
      unit.rows.find(note, {
        where: { op: 'gte', field: 'count', value: 2 },
        page: { first: 1 },
        total: true,
      }),
    );
    expect([page.rows.length, page.total]).toEqual([1, 3]);
  });

  test('position pages count from either end and countBefore ranks a row', async () => {
    const memory = openMemory();
    await seedNotes(memory, rows());
    const sort = [{ field: 'count', direction: 'asc' }] as const;
    const at = (position: number, limit: number): Promise<unknown[]> =>
      memory.read(tenantScope, async (unit) =>
        (await unit.rows.find(note, { sort, page: { position, limit } })).rows.map(
          (row) => row.count,
        ),
      );
    expect(await at(1, 2)).toEqual([2, 3]);
    expect(await at(-1, 2)).toEqual([3]);
    expect(await at(-3, 2)).toEqual([2, 3]);
    const before = await memory.read(tenantScope, async (unit) =>
      unit.rows.countBefore?.(note, { sort }, id(4)),
    );
    expect(before).toBe(3);
    const lost = await failure(
      memory.read(tenantScope, async (unit) => unit.rows.countBefore?.(note, { sort }, id(77))),
    );
    expect(lost.kind).toBe('not_found');
    const far = await failure(at(20_000, 1));
    expect(far.code).toBe('core.malformed_request');
  });
});
