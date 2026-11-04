import type { DataAdapter } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  addBooks,
  behaviours,
  commandKit,
  invokeAsAda,
  rules,
  snapshot,
  type WriteContext,
  withCommand,
} from './support/command-kit.ts';
import { ada, call, failure } from './support/invoker-kit.ts';
import { uuid } from './support/run-read-kit.ts';

describe('the item check, the invariant and the module boundary', () => {
  test('an item check that fails rolls the unit back with forbidden', async () => {
    const reservers = rules.get('loans.library.book.reservers');
    if (reservers === undefined) throw new Error('the fixture has no reservers rule');
    const strict = new Map(rules).set(reservers.id, {
      ...reservers,
      check: () => ({ reservedBy: { isNull: true } }),
    });
    const { registry } = withCommand('noop', () => [], 'library.addBook', {}, strict);
    const { adapter, invoker } = commandKit({ registry });
    const [id] = await addBooks(adapter, 1);
    const error = await invokeAsAda(invoker, 'library.book.reserve', { id }, 'r1').catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ kind: 'forbidden' });
    const { books, events, receipt } = await snapshot(adapter, id, 'r1');
    expect(books[0]?.version).toBe(1);
    expect(books[0]?.reservedBy).toBeUndefined();
    expect(events).toHaveLength(1);
    expect(receipt).toMatchObject({ status: 'failed' });
  });

  test('the entity invariant is checked on every post-image', async () => {
    const guarded = (entity: string) => {
      const known = behaviours(entity);
      return entity === 'library.book' && known !== undefined
        ? { ...known, invariant: (row: { title: string }) => row.title !== 'banned' }
        : known;
    };
    const { adapter, invoker } = commandKit({ behaviours: guarded as typeof behaviours });
    const error = failure(
      await invoker.invoke(
        call('library.addBook', { title: 'banned', isbn: 'i' }, { carrier: ada }),
      ),
    );
    expect(error.kind).toBe('forbidden');
    expect((await snapshot(adapter)).books).toHaveLength(0);
  });

  test('a draft outside the module boundary is forbidden', async () => {
    const probe = withCommand(
      'retitle',
      (input: { bookId: string }, ctx: WriteContext) => [
        ctx.write.library.book.update(input.bookId, { title: 'Renamed' }),
      ],
      'loans.lend',
    );
    const { adapter, invoker } = commandKit({ registry: probe.registry });
    const [id] = await addBooks(adapter, 1);
    const error = failure(await invoker.invoke(call(probe.ref, { bookId: id }, { carrier: ada })));
    expect(error).toMatchObject({ kind: 'forbidden', code: 'core.forbidden' });
    expect((await snapshot(adapter)).books[0]?.title).toBe('Book 1');
  });

  test('a contributed field is writable from the contributor', async () => {
    const probe = withCommand(
      'reserveById',
      (input: { bookId: string }, ctx: WriteContext) => [
        ctx.write.library.book.update(input.bookId, { reservedBy: 'zed' }),
      ],
      'loans.lend',
    );
    const { adapter, invoker } = commandKit({ registry: probe.registry });
    const [id] = await addBooks(adapter, 1);
    const outcome = await invoker.invoke(call(probe.ref, { bookId: id }, { carrier: ada }));
    expect(outcome.ok).toBe(true);
    expect((await snapshot(adapter)).books[0]).toMatchObject({ reservedBy: 'zed', version: 2 });
  });
});

describe('a draft by id', () => {
  const rename = withCommand(
    'rename',
    (input: { bookId: string }, ctx: WriteContext) => [
      ctx.write.library.book.update(input.bookId, { title: 'Renamed' }),
    ],
    'library.addBook',
  );

  test('loads and locks its row, uses its version and records the load', async () => {
    const { adapter, invoker } = commandKit({ registry: rename.registry });
    const [first, second] = await addBooks(adapter, 2);
    await invokeAsAda(invoker, 'library.book.reserve', { id: second });
    const locks: string[] = [];
    const watched: DataAdapter = {
      ...adapter,
      unit: (ns, scope, fn, options) =>
        adapter.unit(
          ns,
          scope,
          (unit) =>
            fn({
              ...unit,
              rows: {
                ...unit.rows,
                find: async (entity, query) => {
                  if (query.forUpdate === true) locks.push(entity.ref);
                  return unit.rows.find(entity, query);
                },
              },
            }),
          options,
        ),
    };
    const outcome = await commandKit({
      registry: rename.registry,
      adapter: watched,
    }).invoker.invoke(call(rename.ref, { bookId: second }, { carrier: ada, commandId: 'n1' }));
    expect(outcome.ok).toBe(true);
    expect(locks).toEqual(['library.book']);
    const { books, events } = await snapshot(adapter, second);
    expect(books.find((row) => row.id === second)).toMatchObject({ title: 'Renamed', version: 3 });
    expect(books.find((row) => row.id === first)?.version).toBe(1);
    expect(events).toHaveLength(3);
    expect(events[2]?.decision?.reads).toEqual([{ at: 3n }]);
    expect(invoker).toBeDefined();
  });

  test('a missing row is not_found, never a version mismatch', async () => {
    const { invoker } = commandKit({ registry: rename.registry });
    const error = failure(
      await invoker.invoke(call(rename.ref, { bookId: uuid(8) }, { carrier: ada })),
    );
    expect(error.kind).toBe('not_found');
  });

  test('a draft built from a row carries its version and finds it', async () => {
    const probe = withCommand(
      'retitleLoaded',
      function* (input: { bookId: string }, ctx: WriteContext) {
        const row = yield* ctx.load.library.book.byId(input.bookId);
        return [ctx.write.library.book.update(row, { title: 'Loaded' })];
      },
      'library.addBook',
    );
    const { adapter, invoker } = commandKit({ registry: probe.registry });
    const [id] = await addBooks(adapter, 1);
    const outcome = await invoker.invoke(call(probe.ref, { bookId: id }, { carrier: ada }));
    expect(outcome.ok).toBe(true);
    const { books, events } = await snapshot(adapter, id);
    expect(books[0]).toMatchObject({ title: 'Loaded', version: 2 });
    expect(events[1]).toMatchObject({ before: { title: 'Book 1' } });
  });

  test('a draft whose row moved since it was read is a version conflict', async () => {
    const probe = withCommand(
      'staleRow',
      function* (input: { bookId: string }, ctx: WriteContext) {
        const row = yield* ctx.load.library.book.byId(input.bookId);
        return [ctx.write.library.book.update({ ...row, version: 99 }, { title: 'Two' })];
      },
      'library.addBook',
    );
    const { adapter, invoker } = commandKit({ registry: probe.registry });
    const [id] = await addBooks(adapter, 1);
    const error = failure(await invoker.invoke(call(probe.ref, { bookId: id }, { carrier: ada })));
    expect(error).toMatchObject({ kind: 'conflict', code: 'core.version_mismatch' });
  });
});
