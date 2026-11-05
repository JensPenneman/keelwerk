import type { RowQuery } from '@keelwerk/core';
import { sql } from 'kysely';
import { describe, expect, test } from 'vitest';
import { contextFor } from '../../test/support/context-for.ts';
import { dummyDb } from '../../test/support/dummy-db.ts';
import { note } from '../../test/support/note.ts';
import { tenantScope } from '../../test/support/tenant-scope.ts';
import { compileRowQuery } from './compile-row-query.ts';
import { cursorSignature } from './cursor-signature.ts';
import { encodeCursor } from './encode-cursor.ts';
import { commandReceiptDescriptor } from './postgres/command-receipt-descriptor.ts';
import { ScopingPlugin } from './scoping-plugin.ts';

const tenant = tenantScope.level === 'tenant' ? tenantScope.tenantId : '';

function compile(query: RowQuery, withPosition = false) {
  const context = contextFor(note);
  const plan = compileRowQuery({
    ...context,
    db: dummyDb(tenantScope),
    query,
    ...(withPosition ? { position: sql`(select next from app.kw_positions)` } : {}),
  });
  return { plan, compiled: plan.select.compile() };
}

const mask = ['title'] as const;
const columns =
  '"t"."id" as "id", "t"."created_at" as "createdAt", "t"."updated_at" as "updatedAt", ' +
  '"t"."archived_at" as "archivedAt", "t"."version"::text as "version", "t"."title" as "title"';
const from = 'from "app"."app__note" as "t"';

describe('statements', () => {
  test('filter, archived default, sort, page size and scope', () => {
    const { compiled } = compile({
      where: { op: 'eq', field: 'title', value: 'a' },
      sort: [{ field: 'title', direction: 'asc' }],
      page: { first: 2 },
      select: mask,
    });
    expect(compiled.sql).toBe(
      `select ${columns} ${from} where ("t"."archived_at" is null and coalesce("t"."title" = $1, false)) ` +
        'and "t"."tenant_id" = $2 order by "t"."title" asc nulls last, "t"."id" asc nulls last limit $3',
    );
    expect(compiled.parameters).toEqual(['a', tenant, 3]);
  });

  test('an invocation table has no archive column to select or filter on', () => {
    const receipt = commandReceiptDescriptor();
    const plan = compileRowQuery({
      ...contextFor(receipt),
      db: dummyDb().withPlugin(
        new ScopingPlugin({
          scope: tenantScope,
          scoped: [{ schema: 'app', name: 'core__command_receipt', column: 'scope_id' }],
        }),
      ),
      query: { select: ['commandId'] },
    });
    const { sql: text } = plan.select.compile();
    expect(text).not.toContain('archived_at');
    expect(text).toContain('"t"."version"::text as "version"');
    expect(text).toContain('"t"."command_id" as "commandId"');
    expect(text).toContain('"t"."scope_id" = $1');
  });

  test('includeArchived drops the archived filter', () => {
    const { compiled } = compile({ select: mask, includeArchived: true });
    expect(compiled.sql).toBe(
      `select ${columns} ${from} where "t"."tenant_id" = $1 order by "t"."id" asc nulls last`,
    );
  });

  test('columns that are 64-bit, decimal or date are selected as text', () => {
    const { compiled } = compile({ select: ['count', 'price', 'due', 'big'] });
    expect(compiled.sql).toContain('"t"."count"::text as "count"');
    expect(compiled.sql).toContain('"t"."price"::text as "price"');
    expect(compiled.sql).toContain('"t"."due"::text as "due"');
    expect(compiled.sql).toContain('"t"."big"::text as "big"');
  });

  test('last pages in reverse order and fetches one more row', () => {
    const { compiled } = compile({
      select: mask,
      sort: [{ field: 'title', direction: 'asc' }],
      page: { last: 2 },
    });
    expect(compiled.sql).toContain(
      'order by "t"."title" desc nulls first, "t"."id" desc nulls first limit $2',
    );
    expect(compiled.parameters).toEqual([tenant, 3]);
  });

  test('after a cursor: the rows beyond it, ties broken by id', () => {
    const sort = [{ field: 'title', direction: 'asc' }] as const;
    const signature = cursorSignature([...sort, { field: 'id', direction: 'asc' }], undefined);
    const cursor = encodeCursor(
      ['title'],
      ['m'],
      '00000000-0000-7000-8000-000000000005',
      signature,
    );
    const { compiled } = compile({ select: mask, sort, page: { first: 2, after: cursor } });
    expect(compiled.sql).toContain(
      'where ("t"."archived_at" is null and (("t"."title" > $1 or "t"."title" is null) or ("t"."title" = $2 and ("t"."id" > $3 or "t"."id" is null))))',
    );
    expect(compiled.parameters.slice(0, 3)).toEqual([
      'm',
      'm',
      '00000000-0000-7000-8000-000000000005',
    ]);
  });

  test('after an absent value in an ascending order only its ties follow', () => {
    const sort = [{ field: 'title', direction: 'asc' }] as const;
    const signature = cursorSignature([...sort, { field: 'id', direction: 'asc' }], undefined);
    const cursor = encodeCursor(
      ['title'],
      [null],
      '00000000-0000-7000-8000-000000000005',
      signature,
    );
    const { compiled } = compile({ select: mask, sort, page: { first: 2, after: cursor } });
    expect(compiled.sql).toContain(
      '(("t"."title" is null and ("t"."id" > $1 or "t"."id" is null)))',
    );
  });

  test('before a cursor in a descending order', () => {
    const sort = [{ field: 'title', direction: 'desc' }] as const;
    const signature = cursorSignature([...sort, { field: 'id', direction: 'asc' }], undefined);
    const cursor = encodeCursor(
      ['title'],
      ['m'],
      '00000000-0000-7000-8000-000000000005',
      signature,
    );
    const { compiled } = compile({ select: mask, sort, page: { last: 2, before: cursor } });
    expect(compiled.sql).toContain('("t"."title" > $1 or "t"."title" is null)');
    expect(compiled.sql).toContain(
      'order by "t"."title" asc nulls last, "t"."id" desc nulls first',
    );
  });

  test('total is a second statement over the same filter, without paging', () => {
    const { plan } = compile({
      where: { op: 'eq', field: 'title', value: 'a' },
      page: { first: 1 },
      total: true,
    });
    const counted = plan.count?.compile();
    expect(counted?.sql).toBe(
      `select count(*)::text as "total" ${from} where ("t"."archived_at" is null and coalesce("t"."title" = $1, false)) and "t"."tenant_id" = $2`,
    );
    expect(compile({}).plan.count).toBeUndefined();
  });

  test('position paging is limit and offset; from the end it reads in reverse', () => {
    expect(compile({ select: mask, page: { position: 4, limit: 2 } }).compiled.sql).toContain(
      'limit $2 offset $3',
    );
    const back = compile({ select: mask, page: { position: -3, limit: 2 } });
    expect(back.compiled.sql).toContain('order by "t"."id" desc nulls first limit $2 offset $3');
    expect(back.compiled.parameters.slice(1)).toEqual([3, 1]);
  });

  test('forUpdate locks the rows', () => {
    expect(compile({ select: mask, forUpdate: true }).compiled.sql).toMatch(/ for update$/);
  });

  test('a positioned query reads the scope counter in the same statement', () => {
    const { compiled } = compile({ select: mask, positioned: true, page: { first: 1 } }, true);
    expect(compiled.sql).toBe(
      'select "r".*, "p"."position" as "kwPosition" from ' +
        '(select ((select next from app.kw_positions))::text as "position") as "p" left join lateral ' +
        `(select ${columns} ${from} where ("t"."archived_at" is null) and "t"."tenant_id" = $1 ` +
        'order by "t"."id" asc nulls last limit $2) as "r" on true order by "r"."id" asc nulls last',
    );
  });
});

describe('read', () => {
  test('a position expression that yields NULL is core.internal, not a SyntaxError', () => {
    const { plan } = compile({ select: mask, positioned: true, page: { first: 1 } }, true);
    const empty = { id: null, kwPosition: null };
    expect(() => plan.read([empty])).toThrow(
      expect.objectContaining({ kind: 'internal', code: 'core.internal' }),
    );
    expect(plan.read([{ ...empty, kwPosition: '7' }]).position).toBe(7n);
  });
});

describe('refusals', () => {
  test.each([
    ['first and last', { first: 1, last: 1 }],
    ['after and before', { first: 1, after: 'x', before: 'y' }],
    ['first with before', { first: 1, before: 'x' }],
    ['last with after', { last: 1, after: 'x' }],
    ['a negative size', { first: -1 }],
    ['a fractional size', { first: 1.5 }],
    ['a position beyond the maximum', { position: 10_001, limit: 1 }],
    ['a position below the minimum', { position: -10_001, limit: 1 }],
    ['a negative limit', { position: 0, limit: -1 }],
  ])('%s is core.malformed_request', (_name, page) => {
    expect(() => compile({ page })).toThrow(
      expect.objectContaining({ kind: 'validation', code: 'core.malformed_request' }),
    );
  });

  test('a cursor issued for another sort is core.cursor_mismatch', () => {
    const cursor = encodeCursor(
      ['title'],
      ['m'],
      '00000000-0000-7000-8000-000000000005',
      'another',
    );
    expect(() =>
      compile({ sort: [{ field: 'title', direction: 'asc' }], page: { first: 1, after: cursor } }),
    ).toThrow(expect.objectContaining({ kind: 'validation', code: 'core.cursor_mismatch' }));
  });

  test('positioned needs the position expression, and cannot lock', () => {
    expect(() => compile({ positioned: true })).toThrow(/position expression/);
    expect(() => compile({ positioned: true, forUpdate: true }, true)).toThrow(
      expect.objectContaining({ code: 'core.malformed_request' }),
    );
  });

  test('a field mask naming an unknown field', () => {
    expect(() => compile({ select: ['nope'] })).toThrow(
      expect.objectContaining({ code: 'core.malformed_request' }),
    );
  });
});

describe('read', () => {
  const raw = (id: string, title: string | null) => ({
    id,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    archivedAt: null,
    version: '2',
    title,
  });

  test('decodes rows, omits absent values and drops the lookahead row', () => {
    const { plan } = compile({
      select: mask,
      sort: [{ field: 'title', direction: 'asc' }],
      page: { first: 2 },
    });
    const page = plan.read([raw('a', 'x'), raw('b', null), raw('c', 'z')]);
    expect(page.rows).toEqual([
      {
        id: 'a',
        createdAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
        updatedAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
        version: 2,
        title: 'x',
      },
      {
        id: 'b',
        createdAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
        updatedAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
        version: 2,
      },
    ]);
    expect(page.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });
  });

  test('cursors carry the sort value, the id and the signature of this sort and filter', () => {
    const sort = [{ field: 'title', direction: 'asc' }] as const;
    const { plan } = compile({ select: mask, sort, page: { first: 5 } });
    const page = plan.read([raw('a', 'x'), raw('b', null)]);
    const signature = cursorSignature([...sort, { field: 'id', direction: 'asc' }], undefined);
    const parts = (cursor: string | null): unknown =>
      JSON.parse(Buffer.from(cursor ?? '', 'base64url').toString('utf8'));
    expect(parts(page.pageInfo.startCursor)).toEqual([['title'], ['x'], 'a', signature]);
    expect(parts(page.pageInfo.endCursor)).toEqual([['title'], [null], 'b', signature]);
    expect(page.pageInfo.hasNextPage).toBe(false);
  });

  test('a backwards page is restored to the sort order', () => {
    const { plan } = compile({ select: mask, page: { last: 2 } });
    const page = plan.read([raw('c', 'z'), raw('b', 'y'), raw('a', 'x')]);
    expect(page.rows.map((row) => row.id)).toEqual(['b', 'c']);
    expect(page.pageInfo).toMatchObject({ hasPreviousPage: true, hasNextPage: false });
  });

  test('the total and the position are carried', () => {
    const counted = compile({ select: mask, total: true }).plan;
    expect(counted.read([], { total: '12' }).total).toBe(12);
    const positioned = compile({ select: mask, positioned: true }, true).plan;
    const page = positioned.read([{ ...raw('a', 'x'), kwPosition: '41' }]);
    expect(page.position).toBe(41n);
    const empty = positioned.read([{ id: null, kwPosition: '7' }]);
    expect(empty.rows).toEqual([]);
    expect(empty.position).toBe(7n);
  });
});
