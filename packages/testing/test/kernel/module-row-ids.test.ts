import { describe, expect, test } from 'vitest';
import { runDirect } from './support/command-kit.ts';
import { command, effectsKit, registryWith, stored } from './support/effects-kit.ts';

type Writer = { write: { library: { book: { create(values: object): unknown } } } };

/** A command whose handler names the id of the book it creates. */
const registry = registryWith({
  actions: [
    command('nameBook', (input, ctx) => ({
      events: [
        (ctx as unknown as Writer).write.library.book.create({
          id: (input as { n?: number; title?: string }).title,
          title: 'T',
          isbn: 't-1',
          addedBy: 'ada',
        }),
      ],
    })),
  ],
});

const nameBook = (title: string) => {
  const { adapter } = effectsKit(registry);
  return {
    adapter,
    run: () =>
      runDirect({
        registry,
        adapter,
        action: 'library.nameBook',
        input: { title },
        commandId: '00000000-0000-7000-8000-000000000011',
      }),
  };
};

const version5 = '886313e1-3b8a-5372-9b90-0c9aee199e5d';
const version7 = '0198a1e0-0000-7000-8000-0000000000b7';

describe('the id a module names in create', () => {
  test('a create with a version 5 UUID is refused with core.request_not_allowed and writes nothing', async () => {
    const { adapter, run } = nameBook(version5);
    await expect(run()).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.request_not_allowed',
    });
    expect((await stored(adapter)).books).toEqual([]);
  });

  test.each([
    ['a ULID (it does not fit the uuid column)', '01ARZ3NDEKTSV4RRFFQ69G5FAV'],
    ['a version 8 id (the form of deriveUuidV8)', '0198a1e0-0000-8000-8000-0000000000b8'],
    ['a version 1 id', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
    ['a version 6 id', '1ec9414c-232a-6b00-b3c8-9e6bdeced846'],
    ['a version 3 id', '6fa459ea-ee8a-3ca4-894e-db77e160355e'],
  ])(
    'a create with %s is refused with core.request_not_allowed and writes nothing',
    async (_name, id) => {
      const { adapter, run } = nameBook(id);
      await expect(run()).rejects.toMatchObject({
        kind: 'internal',
        code: 'core.request_not_allowed',
      });
      expect((await stored(adapter)).books).toEqual([]);
    },
  );

  test.each([
    ['version 4', '3b241101-e2bb-4255-8caf-4136c566a962'],
    ['version 4 in upper case', '3B241101-E2BB-4255-8CAF-4136C566A962'],
  ])('a create with a %s id commits under it', async (_name, id) => {
    const { adapter, run } = nameBook(id);
    await run();
    expect((await stored(adapter)).books.map((row) => row.id)).toEqual([id]);
  });

  test('a create with a text id is refused on the memory adapter', async () => {
    const { adapter, run } = nameBook('ada@example.com');
    await expect(run()).rejects.toMatchObject({ code: 'core.request_not_allowed' });
    expect((await stored(adapter)).books).toEqual([]);
  });

  test('a create with a version 7 id commits under it', async () => {
    const { adapter, run } = nameBook(version7);
    await run();
    expect((await stored(adapter)).books.map((row) => row.id)).toEqual([version7]);
  });

  test('the refusal never holds the id', async () => {
    for (const id of [version5, 'ada@example.com', '01ARZ3NDEKTSV4RRFFQ69G5FAV']) {
      const error = await nameBook(id)
        .run()
        .catch((caught: unknown) => caught);
      expect(JSON.stringify(error)).not.toContain(id);
      expect((error as Error).message).not.toContain(id);
      expect((error as Error).message).toContain('library.book');
    }
  });
});
