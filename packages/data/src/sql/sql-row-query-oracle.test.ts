import type { PGlite } from '@electric-sql/pglite';
import { expressionBuilder } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { contextFor } from '../../test/support/context-for.ts';
import { dummyDb } from '../../test/support/dummy-db.ts';
import { id } from '../../test/support/id.ts';
import { live } from '../../test/support/live.ts';
import { note } from '../../test/support/note.ts';
import { notes } from '../../test/support/notes.ts';
import { openFixture } from '../../test/support/open-fixture.ts';
import { teamRed } from '../../test/support/team-red.ts';
import { tenantScope } from '../../test/support/tenant-scope.ts';
import { compileRowQuery } from './compile-row-query.ts';
import type { SqlDb } from './sql-db.ts';

const date = (text: string): Temporal.PlainDate => Temporal.PlainDate.from(text);
const at = (text: string): Temporal.Instant => Temporal.Instant.from(text);

let pg: PGlite;

beforeAll(async () => {
  pg = await openFixture();
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe('row queries', () => {
  async function run(query: Parameters<typeof compileRowQuery>[0]['query'], position = false) {
    const ctx = contextFor(note);
    const request = {
      ...ctx,
      db: dummyDb(tenantScope),
      query,
      ...(position
        ? {
            position: expressionBuilder<SqlDb, never>()
              .selectFrom('app.kw_positions as k')
              .select('k.next'),
          }
        : {}),
    };
    const plan = compileRowQuery(request);
    const compiled = plan.select.compile();
    const rows = await pg.query<Record<string, unknown>>(compiled.sql, [...compiled.parameters]);
    const counted = plan.count?.compile();
    const total =
      counted === undefined
        ? undefined
        : (await pg.query<Record<string, unknown>>(counted.sql, [...counted.parameters])).rows[0];
    return plan.read(rows.rows, total);
  }

  const byTitle = (direction: 'asc' | 'desc') =>
    live
      .toSorted((a, b) => {
        const ta = a.title as string | undefined;
        const tb = b.title as string | undefined;
        const sign =
          ta === undefined
            ? tb === undefined
              ? 0
              : 1
            : tb === undefined
              ? -1
              : ta < tb
                ? -1
                : ta > tb
                  ? 1
                  : 0;
        const ordered = sign !== 0 ? (direction === 'asc' ? sign : -sign) : 0;
        if (direction === 'desc' && ta === undefined && tb !== undefined) return -1;
        if (direction === 'desc' && tb === undefined && ta !== undefined) return 1;
        return ordered !== 0 ? ordered : String(a.id) < String(b.id) ? -1 : 1;
      })
      .map((row) => String(row.id));

  test('rows come back as domain values, absent values omitted', async () => {
    const page = await run({ where: { op: 'eq', field: 'title', value: 'alpha' } });
    const row = page.rows[0];
    expect(page.rows).toHaveLength(1);
    expect(row).toMatchObject({
      id: id(1),
      version: 1,
      count: 1,
      big: 9007199254740993n,
      price: '1.50',
      ratio: 0.5,
      done: true,
      teamId: teamRed,
      data: { k: 1 },
    });
    expect(row?.due).toEqual(date('2026-01-01'));
    expect(row?.at).toEqual(at('2026-01-01T00:00:00.123Z'));
    expect(row?.tags).toEqual(new Set(['x', 'y']));
    expect(row?.labels).toEqual(['a', 'b']);
    expect(row?.blob).toEqual(new Uint8Array([1, 2]));
    expect(row).not.toHaveProperty('archivedAt');
  });

  test('another tenant sees none of these rows, and archived rows only on request', async () => {
    expect((await run({})).rows.map((row) => row.id)).not.toContain(id(50));
    expect((await run({ includeArchived: true })).rows).toHaveLength(notes.length);
  });

  test.each(['asc', 'desc'] as const)(
    'keyset pages walk the whole order, %s',
    async (direction) => {
      const sort = [{ field: 'title', direction }];
      const seen: string[] = [];
      let after: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await run({
          sort,
          page: { first: 3, ...(after === undefined ? {} : { after }) },
        });
        seen.push(...page.rows.map((row) => String(row.id)));
        expect(page.pageInfo.hasPreviousPage).toBe(after !== undefined);
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor ?? undefined;
      }
      expect(seen).toEqual(byTitle(direction));
    },
  );

  test('backwards pages with last and before mirror the order', async () => {
    const sort = [{ field: 'title', direction: 'asc' as const }];
    const expected = byTitle('asc');
    const tail = await run({ sort, page: { last: 3 } });
    expect(tail.rows.map((row) => row.id)).toEqual(expected.slice(-3));
    expect(tail.pageInfo.hasNextPage).toBe(false);
    expect(tail.pageInfo.hasPreviousPage).toBe(true);
    const before = tail.pageInfo.startCursor ?? undefined;
    const earlier = await run({
      sort,
      page: { last: 3, ...(before === undefined ? {} : { before }) },
    });
    expect(earlier.rows.map((row) => row.id)).toEqual(expected.slice(-6, -3));
    expect(earlier.pageInfo.hasNextPage).toBe(true);
  });

  test('a cursor from another sort or filter is refused', async () => {
    const first = await run({ sort: [{ field: 'title', direction: 'asc' }], page: { first: 2 } });
    const cursor = first.pageInfo.endCursor ?? '';
    await expect(
      run({ sort: [{ field: 'title', direction: 'desc' }], page: { first: 2, after: cursor } }),
    ).rejects.toMatchObject({ kind: 'validation', code: 'core.cursor_mismatch' });
    await expect(
      run({
        where: { op: 'never' },
        sort: [{ field: 'title', direction: 'asc' }],
        page: { first: 2, after: cursor },
      }),
    ).rejects.toMatchObject({ code: 'core.cursor_mismatch' });
  });

  test('keyset paging over a decimal and an instant', async () => {
    const page = await run({ sort: [{ field: 'price', direction: 'asc' }], page: { first: 2 } });
    expect(page.rows.map((row) => row.price)).toEqual(['-1.00', '1.50']);
    const next = await run({
      sort: [{ field: 'price', direction: 'asc' }],
      page: { first: 2, ...(page.pageInfo.endCursor ? { after: page.pageInfo.endCursor } : {}) },
    });
    expect(next.rows.map((row) => row.price)).toEqual(['2.50', '10.00']);
    const present = { op: 'isNull', field: 'at', value: false } as const;
    const instants = await run({
      where: present,
      sort: [{ field: 'at', direction: 'desc' }],
      page: { first: 1 },
    });
    expect(instants.rows[0]?.at).toEqual(at('2026-02-01T00:00:00Z'));
    const after = await run({
      where: present,
      sort: [{ field: 'at', direction: 'desc' }],
      page: { first: 1, after: instants.pageInfo.endCursor ?? '' },
    });
    expect(after.rows[0]?.at).toEqual(at('2026-01-01T00:00:00.123Z'));
  });

  test('total counts the filter, not the page', async () => {
    const page = await run({ page: { first: 2 }, total: true });
    expect(page.total).toBe(live.length);
    expect(page.rows).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);
  });

  test('position paging, forward and from the end', async () => {
    const order = [...live].map((row) => String(row.id)).sort();
    const forward = await run({ page: { position: 2, limit: 3 } });
    expect(forward.rows.map((row) => row.id)).toEqual(order.slice(2, 5));
    expect(forward.pageInfo).toMatchObject({ hasPreviousPage: true, hasNextPage: true });
    const back = await run({ page: { position: -3, limit: 2 } });
    expect(back.rows.map((row) => row.id)).toEqual(order.slice(-3, -1));
    expect(back.pageInfo).toMatchObject({ hasPreviousPage: true, hasNextPage: true });
    const last = await run({ page: { position: -1, limit: 5 } });
    expect(last.rows.map((row) => row.id)).toEqual(order.slice(-1));
    expect(last.pageInfo.hasNextPage).toBe(false);
    await expect(run({ page: { position: 10_001, limit: 1 } })).rejects.toMatchObject({
      code: 'core.malformed_request',
    });
  });

  test('a positioned query returns the scope position, also for no rows', async () => {
    const some = await run({ positioned: true, page: { first: 1 } }, true);
    expect(some.position).toBe(42n);
    expect(some.rows).toHaveLength(1);
    const none = await run({ positioned: true, where: { op: 'never' }, page: { first: 1 } }, true);
    expect(none.rows).toEqual([]);
    expect(none.position).toBe(42n);
    expect(none.pageInfo).toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    });
  });

  test('a field mask still returns the system fields', async () => {
    const page = await run({ select: ['title'], page: { first: 1 } });
    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual(
      ['createdAt', 'id', 'title', 'updatedAt', 'version'].filter(
        (key) => key in (page.rows[0] ?? {}),
      ),
    );
    expect(page.rows[0]).not.toHaveProperty('count');
  });
});
