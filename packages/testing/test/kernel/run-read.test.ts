import type {
  DataAdapter,
  EntityDescriptor,
  FieldDescriptor,
  NamespaceRef,
  Registry,
  RuleEntry,
  StorageRow,
  StorageScope,
  Unit,
} from '@keelwerk/core';
import { normalizeRule } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { ProbeContext } from './support/run-read-kit.ts';
import {
  anonymous,
  book,
  bookRow,
  counting,
  registry,
  runnable,
  uuid,
  withQuery,
} from './support/run-read-kit.ts';

describe('the fixture query', () => {
  test('findByIsbn is answered from seeded rows with every load tagged with its position', async () => {
    const { seed, run } = runnable({ action: 'library.findByIsbn', input: { isbn: 'isbn-2' } });
    await seed([bookRow(1), bookRow(2)]);
    const result = await run();
    expect(result.output).toEqual({ bookId: uuid(2), title: 'Book 2' });
    expect(result.head).toBeNull();
    expect(result.reads).toEqual([{ at: 0n }]);
    expect(result.flags).toEqual([]);
  });

  test('a missing isbn answers an empty output', async () => {
    const { seed, run } = runnable({ action: 'library.findByIsbn', input: { isbn: 'nope' } });
    await seed([bookRow(1)]);
    expect((await run()).output).toEqual({ bookId: undefined, title: undefined });
  });

  test('the query runs in a read-only unit', async () => {
    const probe = withQuery('readOnly', () => 'ok');
    const { adapter, run } = runnable({ registry: probe.registry, action: probe.ref });
    const opened: boolean[] = [];
    const spying = {
      ...adapter,
      unit: (
        ns: NamespaceRef,
        scope: StorageScope,
        fn: (unit: Unit) => Promise<unknown>,
        options?: object,
      ) =>
        adapter.unit(
          ns,
          scope,
          (unit) => {
            opened.push(unit.readOnly);
            return fn(unit);
          },
          options,
        ),
    } as unknown as DataAdapter;
    await run({ adapter: spying });
    expect(opened).toEqual([true]);
  });
});

describe('module authority and the caller view', () => {
  const sees = withQuery('sees', function* (_input: unknown, ctx: ProbeContext) {
    const all = yield* ctx.load.library.book.many({});
    const mine = yield* ctx.load.library.book.forCaller().many({});
    const total = yield* ctx.load.library.book.count();
    const callerTotal = yield* ctx.load.library.book.forCaller().count();
    return { all: all.length, mine: mine.map((row: StorageRow) => row.id), total, callerTotal };
  });
  const ownOnly: RuleEntry = (() => {
    const readers = registry.rules.get('library.book.readers');
    if (readers === undefined) throw new Error('the library fixture has no readers rule');
    return {
      ...readers,
      id: 'library.book.own',
      where: (context: unknown) => ({
        addedBy: (context as { principal: { subject: string } }).principal.subject,
      }),
    };
  })();

  test('the module sees every row while forCaller narrows to the caller plan', async () => {
    const { seed, run } = runnable({ registry: sees.registry, action: sees.ref });
    await seed([bookRow(1), bookRow(2, { addedBy: 'bob' }), bookRow(3, { addedBy: 'bob' })]);
    const result = await run({ rules: [normalizeRule(ownOnly)] });
    expect(result.output).toEqual({ all: 3, mine: [uuid(1)], total: 3, callerTotal: 1 });
  });

  test('an anonymous caller has no read plan, so forCaller answers nothing and the module still counts', async () => {
    const { seed, run } = runnable({
      registry: sees.registry,
      action: sees.ref,
      principal: anonymous,
    });
    await seed([bookRow(1), bookRow(2)]);
    const result = await run();
    expect(result.output).toEqual({ all: 2, mine: [], total: 2, callerTotal: 0 });
  });

  test('masked fields are left out for the caller and cannot be filtered on', async () => {
    const maskedBook: EntityDescriptor = {
      ...book,
      fields: {
        ...book.fields,
        title: { ...(book.fields.title as FieldDescriptor), maskable: true },
      },
    };
    const masked: Registry = {
      ...registry,
      entities: new Map(
        [...registry.entities].map(([ref, entry]) => [
          ref,
          ref === 'library.book' ? { ...entry, descriptor: maskedBook } : entry,
        ]),
      ),
    };
    const revealsIsbnOnly: RuleEntry = {
      ...ownOnly,
      id: 'library.book.isbnOnly',
      fields: ['isbn'],
    };
    const rules = [normalizeRule({ ...revealsIsbnOnly, where: () => ({}) })];
    const read = withQuery(
      'maskedRead',
      function* (_input: unknown, ctx: ProbeContext) {
        return {
          caller: yield* ctx.load.library.book.forCaller().many({}),
          module: yield* ctx.load.library.book.many({}),
        };
      },
      masked,
    );
    const { seed, run } = runnable({ registry: read.registry, action: read.ref });
    await seed([bookRow(1)]);
    const result = (await run({ rules })).output as {
      caller: readonly StorageRow[];
      module: readonly StorageRow[];
    };
    expect(result.caller[0]).not.toHaveProperty('title');
    expect(result.caller[0]).toMatchObject({ isbn: 'isbn-1', $masked: ['title'] });
    expect(result.module[0]).toMatchObject({ title: 'Book 1' });

    const filter = withQuery(
      'maskedFilter',
      function* (_input: unknown, ctx: ProbeContext) {
        return yield* ctx.load.library.book.forCaller().many({ where: { title: 'Book 1' } });
      },
      masked,
    );
    const blocked = runnable({ registry: filter.registry, action: filter.ref });
    await blocked.seed([bookRow(1)]);
    await expect(blocked.run({ rules })).rejects.toMatchObject({ code: 'core.forbidden' });
  });
});

describe('positions and order', () => {
  test('positions are recorded in yield order', async () => {
    const probe = withQuery('order', function* (_input: unknown, ctx: ProbeContext) {
      const first = yield* ctx.load.library.book.byId(uuid(1));
      const count = yield* ctx.load.library.book.count();
      const exists = yield* ctx.load.library.book.exists({ isbn: 'isbn-2' });
      return { first: first?.title, count, exists };
    });
    const { adapter, seed, run } = runnable({ registry: probe.registry, action: probe.ref });
    await seed([bookRow(1), bookRow(2)]);
    const result = await run({ adapter: counting(adapter), concurrentUnits: true });
    expect(result.output).toEqual({ first: 'Book 1', count: 2, exists: true });
    expect(result.reads).toEqual([{ at: 1n }, { at: 2n }, { at: 3n }]);
  });

  test('ctx.all keeps its members order; its two byId members share one positioned read', async () => {
    const probe = withQuery('together', function* (_input: unknown, ctx: ProbeContext) {
      const loads = ctx.load.library.book;
      return yield* ctx.all([loads.byId(uuid(2)), loads.byId(uuid(1)), loads.count()]);
    });
    const { adapter, seed, run } = runnable({ registry: probe.registry, action: probe.ref });
    await seed([bookRow(1), bookRow(2)]);
    const result = await run({ adapter: counting(adapter), concurrentUnits: true });
    const answers = result.output as [StorageRow, StorageRow, number];
    expect([answers[0].title, answers[1].title, answers[2]]).toEqual(['Book 2', 'Book 1', 2]);
    expect(result.reads).toEqual([{ at: 1n }, { at: 1n }, { at: 2n }]);
  });

  test('a returned request is planned and answered, a plain value is the output', async () => {
    const request = withQuery('returned', (_input: unknown, ctx: ProbeContext) =>
      ctx.load.library.book.count(),
    );
    const plain = withQuery('plain', () => ({ fixed: true }));
    const a = runnable({ registry: request.registry, action: request.ref });
    await a.seed([bookRow(1), bookRow(2), bookRow(3)]);
    expect((await a.run()).output).toBe(3);
    const b = runnable({ registry: plain.registry, action: plain.ref });
    expect((await b.run()).output).toEqual({ fixed: true });
  });

  test('query pages against the entity paging and many caps its limit', async () => {
    const probe = withQuery('paged', function* (_input: unknown, ctx: ProbeContext) {
      const page = yield* ctx.load.library.book.query({ page: { first: 2 } });
      const next = yield* ctx.load.library.book.query({
        page: { first: 2, after: page.pageInfo.endCursor },
      });
      return [
        page.items.length,
        page.pageInfo.hasNextPage,
        next.items.length,
        next.pageInfo.hasNextPage,
      ];
    });
    const { seed, run } = runnable({ registry: probe.registry, action: probe.ref });
    await seed([bookRow(1), bookRow(2), bookRow(3)]);
    expect((await run()).output).toEqual([2, true, 1, false]);
    const tooMany = withQuery('tooMany', function* (_input: unknown, ctx: ProbeContext) {
      return yield* ctx.load.library.book.many({ limit: 1001 });
    });
    const bad = runnable({ registry: tooMany.registry, action: tooMany.ref });
    await expect(bad.run()).rejects.toMatchObject({ code: 'core.validation' });
    const unsortable = withQuery('unsortable', function* (_input: unknown, ctx: ProbeContext) {
      return yield* ctx.load.library.book.query({ sort: [{ field: 'title', direction: 'asc' }] });
    });
    const sorted = runnable({ registry: unsortable.registry, action: unsortable.ref });
    await expect(sorted.run()).rejects.toMatchObject({ code: 'core.validation' });
  });
});

describe('ctx.ask', () => {
  const asking = withQuery('asking', function* (_input: unknown, ctx: ProbeContext) {
    return yield* ctx.ask('library.findByIsbn', { isbn: 'isbn-1' });
  });

  test('runs the dependency query in the same unit, gated as the caller', async () => {
    const { seed, run } = runnable({ registry: asking.registry, action: asking.ref });
    await seed([bookRow(1)]);
    const result = await run();
    expect(result.output).toEqual({ bookId: uuid(1), title: 'Book 1' });
    expect(result.reads).toEqual([{ at: 0n }]);
  });

  test('is forbidden for a principal the gate does not allow', async () => {
    const { seed, run } = runnable({
      registry: asking.registry,
      action: asking.ref,
      principal: anonymous,
    });
    await seed([bookRow(1)]);
    await expect(run()).rejects.toMatchObject({ code: 'core.forbidden' });
  });

  test('refuses a query of a module that is not the asker or one of its dependencies', async () => {
    const outside = withQuery('askingOutside', function* (_input: unknown, ctx: ProbeContext) {
      return yield* ctx.ask('core.me', {});
    });
    const { run } = runnable({ registry: outside.registry, action: outside.ref });
    await expect(run()).rejects.toMatchObject({
      code: 'core.request_not_allowed',
      message: expect.stringContaining('dependency'),
    });
  });

  test('refuses a reference that is not a query of the app', async () => {
    const bad = withQuery('askingBad', function* (_input: unknown, ctx: ProbeContext) {
      return yield* ctx.ask('library.addBook', {});
    });
    const { run } = runnable({ registry: bad.registry, action: bad.ref });
    await expect(run()).rejects.toMatchObject({ code: 'core.request_not_allowed' });
  });
});
