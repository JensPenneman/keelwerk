import type { RowPage, RowQuery, StorageRow } from '@keelwerk/core';
import { conformanceEntities, conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { rowAt } from './row-at.ts';

const { probe } = conformanceEntities;
const scope = conformanceScopes.tenantA;

/** Row `i` (1 to 25) has the unique `n` of a permutation; rows 31 to 34 have no `n`. */
const rows: readonly StorageRow[] = [
  ...Array.from({ length: 25 }, (_, index) =>
    rowAt(300 + index + 1, { n: ((index + 1) * 7) % 25, flag: index % 3 === 0 }),
  ),
  ...[31, 32, 33, 34].map((i) => rowAt(300 + i, { flag: i % 2 === 0 })),
];

const present = rows.filter((row) => row.n !== undefined);
const absent = rows.filter((row) => row.n === undefined);
const byN = present.toSorted((a, b) => Number(a.n) - Number(b.n)).map((row) => String(row.id));
const absentIds = absent.map((row) => String(row.id)).sort();
const ascending = [...byN, ...absentIds];
const descending = [...absentIds, ...byN.toReversed()];

const ids = (page: RowPage): string[] => page.rows.map((row) => String(row.id));

async function seed(subject: ConformanceSubject): Promise<void> {
  await subject.run(scope, (unit) => unit.rows.insert(probe, rows));
}

async function walk(
  subject: ConformanceSubject,
  direction: 'asc' | 'desc',
  size: number,
): Promise<RowPage[]> {
  const pages: RowPage[] = [];
  let after: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const page = await subject.read(scope, (unit) =>
      unit.rows.find(probe, {
        sort: [{ field: 'n', direction }],
        page: { first: size, ...(after === undefined ? {} : { after }) },
      }),
    );
    pages.push(page);
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) break;
    after = page.pageInfo.endCursor;
  }
  return pages;
}

function unitFind(subject: ConformanceSubject, query: RowQuery): Promise<unknown> {
  return subject.read(scope, (unit) => unit.rows.find(probe, query));
}

export function paginationCases(subject: ConformanceSubject): void {
  describe('keyset pagination (14.3.5, 14.10 case 3)', () => {
    test('first and after walk the whole set in sort order; absent values sort last ascending', async () => {
      await seed(subject);
      const pages = await walk(subject, 'asc', 7);
      expect(pages.map((page) => page.rows.length)).toEqual([7, 7, 7, 7, 1]);
      const seen = pages.flatMap(ids);
      expect(seen.slice(0, 25)).toEqual(byN);
      expect(seen.slice(25).sort()).toEqual(absentIds);
      expect(pages.map((page) => page.pageInfo.hasNextPage)).toEqual([
        true,
        true,
        true,
        true,
        false,
      ]);
      expect(pages.map((page) => page.pageInfo.hasPreviousPage)).toEqual([
        false,
        true,
        true,
        true,
        true,
      ]);
    });

    test('absent values sort first descending', async () => {
      await seed(subject);
      const seen = (await walk(subject, 'desc', 10)).flatMap(ids);
      expect(seen.slice(0, 4).sort()).toEqual(absentIds);
      expect(seen.slice(4)).toEqual(descending.slice(4));
    });

    test('last and before walk the set backwards', async () => {
      await seed(subject);
      const collected: string[][] = [];
      let before: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await subject.read(scope, (unit) =>
          unit.rows.find(probe, {
            sort: [{ field: 'n', direction: 'asc' }],
            page: { last: 8, ...(before === undefined ? {} : { before }) },
          }),
        );
        collected.unshift(ids(page));
        if (!page.pageInfo.hasPreviousPage || page.pageInfo.startCursor === null) break;
        before = page.pageInfo.startCursor;
      }
      const seen = collected.flat();
      expect(seen.slice(0, 25)).toEqual(byN);
      expect(seen.slice(25).sort()).toEqual(absentIds);
      expect(collected.map((page) => page.length)).toEqual([5, 8, 8, 8]);
    });

    test('ties are broken by id, so a sort over a column with few values pages without gaps or repeats', async () => {
      await seed(subject);
      const seen: string[] = [];
      let after: string | undefined;
      for (let guard = 0; guard < 40; guard++) {
        const page = await subject.read(scope, (unit) =>
          unit.rows.find(probe, {
            sort: [{ field: 'flag', direction: 'desc' }],
            page: { first: 4, ...(after === undefined ? {} : { after }) },
          }),
        );
        seen.push(...ids(page));
        if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) break;
        after = page.pageInfo.endCursor;
      }
      expect(seen).toHaveLength(rows.length);
      expect(new Set(seen).size).toBe(rows.length);
      const flags = seen.map((id) => rows.find((row) => String(row.id) === id)?.flag);
      const firstFalse = flags.indexOf(false);
      expect(flags.slice(firstFalse).every((flag) => flag === false || flag === undefined)).toBe(
        true,
      );
    });

    test('total is an opt-in count of the whole result, not of the page', async () => {
      await seed(subject);
      const withTotal = await subject.read(scope, (unit) =>
        unit.rows.find(probe, { page: { first: 3 }, total: true }),
      );
      expect(withTotal.total).toBe(rows.length);
      const without = await subject.read(scope, (unit) =>
        unit.rows.find(probe, { page: { first: 3 } }),
      );
      expect(without.total).toBeUndefined();
      const filtered = await subject.read(scope, (unit) =>
        unit.rows.find(probe, {
          where: { op: 'gte', field: 'n', value: 20 },
          page: { first: 1 },
          total: true,
        }),
      );
      expect(filtered.total).toBe(
        byN.filter((id) => Number(rows.find((row) => row.id === id)?.n) >= 20).length,
      );
    });

    test('pages stay stable while rows are inserted between requests', async () => {
      await seed(subject);
      const sort = [{ field: 'n', direction: 'asc' }] as const;
      const first = await subject.read(scope, (unit) =>
        unit.rows.find(probe, { sort, page: { first: 5 } }),
      );
      expect(ids(first)).toEqual(byN.slice(0, 5));
      await subject.run(scope, (unit) =>
        unit.rows.insert(probe, [
          rowAt(400, { n: -50 }),
          rowAt(401, { n: byN.length }),
          rowAt(402, { n: 1000 }),
        ]),
      );
      const second = await subject.read(scope, (unit) =>
        unit.rows.find(probe, {
          sort,
          page: { first: 5, after: first.pageInfo.endCursor ?? '' },
        }),
      );
      expect(ids(second)).toEqual(byN.slice(5, 10));
      const later = await subject.read(scope, (unit) =>
        unit.rows.find(probe, { sort, page: { first: 100 } }),
      );
      expect(ids(later)[0]).toBe(conformanceId(400));
      expect(ids(later).at(-5)).toBe(conformanceId(402));
    });

    test('a cursor issued for another sort or another filter is a validation error', async () => {
      await seed(subject);
      const issued = await subject.read(scope, (unit) =>
        unit.rows.find(probe, { sort: [{ field: 'n', direction: 'asc' }], page: { first: 3 } }),
      );
      const cursor = issued.pageInfo.endCursor ?? '';
      const otherSort = unitFind(subject, {
        sort: [{ field: 'n', direction: 'desc' }],
        page: { first: 3, after: cursor },
      });
      expect(await failureOf(otherSort)).toEqual({
        kind: 'validation',
        code: 'core.cursor_mismatch',
      });
      const otherFilter = unitFind(subject, {
        sort: [{ field: 'n', direction: 'asc' }],
        where: { op: 'gt', field: 'n', value: 3 },
        page: { first: 3, after: cursor },
      });
      expect(await failureOf(otherFilter)).toEqual({
        kind: 'validation',
        code: 'core.cursor_mismatch',
      });
      const garbage = unitFind(subject, { page: { first: 3, after: 'not-a-cursor' } });
      expect((await failureOf(garbage)).kind).toBe('validation');
    });

    test('first with last, and after with before, are refused', async () => {
      await seed(subject);
      expect((await failureOf(unitFind(subject, { page: { first: 1, last: 1 } }))).kind).toBe(
        'validation',
      );
      expect(
        (await failureOf(unitFind(subject, { page: { first: 1, after: 'a', before: 'b' } }))).kind,
      ).toBe('validation');
    });

    test('a select mask keeps the system fields and a sort key it did not select', async () => {
      await seed(subject);
      const page = await subject.read(scope, (unit) =>
        unit.rows.find(probe, {
          select: ['flag'],
          sort: [{ field: 'n', direction: 'asc' }],
          page: { first: 1 },
        }),
      );
      const row = page.rows[0] ?? {};
      for (const name of ['id', 'createdAt', 'updatedAt', 'version', 'flag'])
        expect(name in row).toBe(true);
      expect('label' in row).toBe(false);
    });
  });

  describe('position paging (14.3.5)', () => {
    const order = [{ field: 'n', direction: 'asc' }] as const;

    test('positions count from the start, negative ones from the end, and past the end is empty', async (t) => {
      const capability = subject.capabilities().positionPaging;
      if (capability === false) return t.skip();
      await seed(subject);
      const at = async (position: number, limit: number): Promise<string[]> =>
        ids(
          await subject.read(scope, (unit) =>
            unit.rows.find(probe, { sort: order, page: { position, limit } }),
          ),
        );
      expect(await at(0, 5)).toEqual(ascending.slice(0, 5));
      expect(await at(10, 5)).toEqual(ascending.slice(10, 15));
      expect(await at(27, 10)).toEqual(ascending.slice(27));
      expect(await at(-3, 2)).toEqual(ascending.slice(-3, -1));
      expect(await at(-1, 5)).toEqual(ascending.slice(-1));
      expect(await at(-29, 3)).toEqual(ascending.slice(0, 3));
      expect(await at(-40, 3)).toEqual([]);
      expect(await at(100, 5)).toEqual([]);
    });

    test('a position beyond the maximum offset is a validation error, never an unbounded scan', async (t) => {
      const capability = subject.capabilities().positionPaging;
      if (capability === false) return t.skip();
      await seed(subject);
      const beyond = unitFind(subject, {
        sort: order,
        page: { position: capability.maxOffset + 1, limit: 1 },
      });
      expect((await failureOf(beyond)).kind).toBe('validation');
    });

    test('countBefore gives the rank of an anchor, also when the anchor is outside the filtered result', async (t) => {
      if (subject.capabilities().positionPaging === false) return t.skip();
      await seed(subject);
      const rankBefore = (
        id: string,
        where?: { op: 'gte'; field: string; value: number },
      ): Promise<number> =>
        subject.read(scope, (unit) => {
          if (unit.rows.countBefore === undefined)
            throw new Error('positionPaging without countBefore');
          return unit.rows.countBefore(
            probe,
            { sort: order, ...(where === undefined ? {} : { where }) },
            id,
          );
        });
      expect(await rankBefore(ascending[0] ?? '')).toBe(0);
      expect(await rankBefore(ascending[12] ?? '')).toBe(12);
      expect(await rankBefore(ascending[28] ?? '')).toBe(28);
      const kept = ascending.filter(
        (id) => Number(rows.find((row) => String(row.id) === id)?.n) >= 10,
      );
      expect(await rankBefore(kept[3] ?? '', { op: 'gte', field: 'n', value: 10 })).toBe(3);
      const left =
        byN.find((id) => Number(rows.find((row) => String(row.id) === id)?.n) === 5) ?? '';
      expect(await rankBefore(left, { op: 'gte', field: 'n', value: 10 })).toBe(0);
    });
  });
}
