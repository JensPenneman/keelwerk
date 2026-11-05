import type { ActionEntry } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { ProbeContext } from './support/run-read-kit.ts';
import { bookRow, runnable, uuid, withQuery } from './support/run-read-kit.ts';

describe('the sorts of an action over its own entity', () => {
  const narrowed = (
    sortable: readonly string[],
    read: (ctx: ProbeContext) => Generator<unknown, unknown, unknown>,
  ) => {
    const probe = withQuery('narrowed', function* (_input: unknown, ctx: ProbeContext) {
      return yield* read(ctx);
    });
    const base = probe.registry.actions.get(probe.ref);
    if (base === undefined) throw new Error('the probe action is missing');
    const action = {
      ...base,
      entityOutput: { entity: 'library.book', shape: 'page' },
      page: { sortable, defaultSort: [], defaultSize: 50, maxSize: 500 },
    } as ActionEntry;
    const registry = {
      ...probe.registry,
      actions: new Map([...probe.registry.actions, [probe.ref, action]]),
    };
    return runnable({ registry, action: probe.ref });
  };
  const sortedBy = (field: string) =>
    narrowed(['id', 'title'], (ctx) =>
      ctx.load.library.book.forCaller().query({ sort: [{ field, direction: 'asc' }] }),
    );

  test("an action's page.sortable narrows the sorts of the caller's loads of its own entity, never widens them (6.7)", async () => {
    const allowed = sortedBy('id');
    await allowed.seed([bookRow(2), bookRow(1)]);
    const answered = (await allowed.run()).output as { items: { id: string }[] };
    expect(answered.items.map((row) => row.id)).toEqual([uuid(1), uuid(2)]);
    // the entity sorts by createdAt, but this action does not list it
    await expect(sortedBy('createdAt').run()).rejects.toMatchObject({ code: 'core.validation' });
    // the action lists title, which the entity does not index
    await expect(sortedBy('title').run()).rejects.toMatchObject({ code: 'core.validation' });
  });

  test('id and the default sort stay allowed when the action omits them, and the module loads are never narrowed (8.4)', async () => {
    const plain = narrowed(['isbn'], (ctx) => ctx.load.library.book.forCaller().query({}));
    await plain.seed([bookRow(2), bookRow(1)]);
    const out = (await plain.run()).output as { items: { id: string }[] };
    expect(out.items.map((row) => row.id)).toEqual([uuid(1), uuid(2)]);
    const byId = narrowed(['isbn'], (ctx) =>
      ctx.load.library.book.forCaller().query({ sort: [{ field: 'id', direction: 'desc' }] }),
    );
    await byId.seed([bookRow(2), bookRow(1)]);
    const desc = (await byId.run()).output as { items: { id: string }[] };
    expect(desc.items.map((row) => row.id)).toEqual([uuid(2), uuid(1)]);
    const module = narrowed(['isbn'], (ctx) =>
      ctx.load.library.book.query({ sort: [{ field: 'createdAt', direction: 'asc' }] }),
    );
    await module.seed([bookRow(1)]);
    expect(((await module.run()).output as { items: unknown[] }).items).toHaveLength(1);
  });
});
