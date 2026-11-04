import { describe, expect, test } from 'vitest';
import { addBooks, commandKit, flaky, invokeAsAda, snapshot } from './support/command-kit.ts';
import { ada, call, failure } from './support/invoker-kit.ts';
import { uuid } from './support/run-read-kit.ts';

describe('create', () => {
  test('addBook stores the row, the created event and a completed receipt', async () => {
    const { adapter, invoker } = commandKit();
    const outcome = await invoker.invoke(
      call('library.addBook', { title: 'Dune', isbn: 'isbn-1' }, { carrier: ada, commandId: 'c1' }),
    );
    expect(outcome.ok).toBe(true);
    const [row] = (await snapshot(adapter)).books;
    expect(row).toMatchObject({ title: 'Dune', isbn: 'isbn-1', addedBy: 'ada', version: 1 });
    const { events, receipt } = await snapshot(adapter, String(row?.id), 'c1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'library.book.created',
      version: 1,
      data: { values: { title: 'Dune', isbn: 'isbn-1', addedBy: 'ada' } },
      before: null,
      commandId: 'c1',
      action: 'library.addBook',
      transient: false,
      actor: { kind: 'user', id: 'ada' },
    });
    expect(events[0]?.decision?.answers).toEqual([
      { kind: 'id', entity: 'library.book', value: row?.id },
    ]);
    expect(receipt).toMatchObject({ status: 'completed', action: 'library.addBook' });
    expect(receipt?.outcome).toMatchObject({ ok: true, effects: [] });
  });

  test('a rejected decision stores nothing', async () => {
    const { adapter, invoker } = commandKit();
    const input = { title: 'Dune', isbn: 'isbn-1' };
    await invoker.invoke(call('library.addBook', input, { carrier: ada, commandId: 'c1' }));
    const second = failure(
      await invoker.invoke(call('library.addBook', input, { carrier: ada, commandId: 'c2' })),
    );
    expect(second.code).toBe('library.isbn_taken');
    const { books, receipt } = await snapshot(adapter, undefined, 'c2');
    expect(books).toHaveLength(1);
    expect(receipt).toBeUndefined();
  });
});

describe('update with a version', () => {
  const seeded = async () => {
    const { adapter, invoker } = commandKit();
    const [id] = await addBooks(adapter, 1);
    return { adapter, invoker, id: id ?? '' };
  };

  test('reserve changes the contributed field, bumps the version and keeps the before-image', async () => {
    const { adapter, invoker, id } = await seeded();
    const result = await invokeAsAda(invoker, 'library.book.reserve', { id, ifVersion: 1 }, 'r1');
    expect(result.output).toMatchObject({ id, reservedBy: 'ada', version: 2 });
    const { books, events, receipt } = await snapshot(adapter, id, 'r1');
    expect(books[0]).toMatchObject({ reservedBy: 'ada', version: 2, title: 'Book 1' });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: 'library.book.changed',
      version: 2,
      data: { set: { reservedBy: 'ada' } },
      before: { reservedBy: null },
    });
    expect(events[1]?.decision?.reads).toEqual([{ at: 1n }]);
    expect(receipt?.outcome).toMatchObject({
      ok: true,
      ref: { entity: 'library.book', id, version: 2 },
    });
  });

  test('an ifVersion that is not the row version is core.version_mismatch and runs once', async () => {
    const { adapter, id } = await seeded();
    const counted = flaky(adapter, 0);
    const { invoker } = commandKit({ adapter: counted.adapter });
    const error = await invokeAsAda(invoker, 'library.book.reserve', { id, ifVersion: 7 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ kind: 'conflict', code: 'core.version_mismatch' });
    expect(counted.units()).toBe(1);
    expect((await snapshot(counted.adapter)).books[0]?.version).toBe(1);
  });

  test('a target outside the table is not_found', async () => {
    const { invoker } = await seeded();
    const error = await invokeAsAda(invoker, 'library.book.reserve', { id: uuid(9) }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ kind: 'not_found' });
  });
});

describe('conflicts and retries', () => {
  test('a conflict on the append is retried and the command commits once', async () => {
    const { adapter, units } = flaky(commandKit().adapter, 1);
    const { invoker } = commandKit({ adapter });
    const outcome = await invoker.invoke(
      call('library.addBook', { title: 'Dune', isbn: 'isbn-1' }, { carrier: ada, commandId: 'c1' }),
    );
    expect(outcome.ok).toBe(true);
    expect(units()).toBe(2);
    const { books, receipt } = await snapshot(adapter, undefined, 'c1');
    expect(books).toHaveLength(1);
    expect(receipt?.status).toBe('completed');
  });

  test('after the third retry the conflict reaches the caller', async () => {
    const { adapter, units } = flaky(commandKit().adapter, 10);
    const { invoker } = commandKit({ adapter });
    const error = failure(
      await invoker.invoke(
        call('library.addBook', { title: 'Dune', isbn: 'isbn-1' }, { carrier: ada }),
      ),
    );
    expect(error).toMatchObject({ kind: 'conflict', code: 'core.version_mismatch' });
    expect(units()).toBe(4);
    expect((await snapshot(adapter)).books).toHaveLength(0);
  });
});
