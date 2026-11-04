import type { TrackSnapshot } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { GeneratedMigration, TrackFiles } from '../../src/index.ts';
import { applyPending, planTrack } from '../../src/index.ts';
import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { entryWithFields } from './support/entry-with-fields.ts';
import { fieldDescriptor } from './support/field-descriptor.ts';
import { libraryBook } from './support/library-book.ts';
import { libraryTrack } from './support/library-track.ts';
import { migratingPglite } from './support/migrating-pglite.ts';
import { migrationNamespace } from './support/migration-namespace.ts';
import { noRename } from './support/no-rename.ts';

let adapter: PgliteAdapter;

beforeAll(async () => {
  adapter = await migratingPglite();
}, 60_000);

afterAll(async () => {
  await adapter?.close(1000);
}, 60_000);

const base = libraryTrack(libraryBook);

/** The book with `note` added (optional) and a later `rating` column (required). */
const withNote = libraryTrack(
  entryWithFields(libraryBook, {
    ...libraryBook.descriptor.fields,
    note: fieldDescriptor('note', 'text', { optional: true, tag: 20 }),
  }),
);
const withRating = libraryTrack(
  entryWithFields(libraryBook, {
    ...libraryBook.descriptor.fields,
    note: fieldDescriptor('note', 'text', { optional: true, tag: 20 }),
    rating: fieldDescriptor('rating', 'integer', { optional: true, tag: 21 }),
  }),
);
const withoutTitle = (() => {
  const { title: _title, ...rest } = libraryBook.descriptor.fields;
  return libraryTrack(
    entryWithFields(libraryBook, {
      ...rest,
      note: fieldDescriptor('note', 'text', { optional: true, tag: 20 }),
      rating: fieldDescriptor('rating', 'integer', { optional: true, tag: 21 }),
    }),
  );
})();

/** The files that take the track through the given states in turn, each planned from the one before. */
async function filesThrough(
  states: readonly (readonly [string, typeof base])[],
): Promise<TrackFiles> {
  const files: GeneratedMigration[] = [];
  let previous: TrackSnapshot | null = null;
  for (const [name, desired] of states) {
    const plan = await planTrack({ previous, desired, name, ask: noRename });
    if (plan === null) continue;
    files.push(...plan.files);
    previous = plan.snapshot;
  }
  return { track: 'library', files };
}

const initialThroughRating = [
  ['initial', base],
  ['note', withNote],
  ['rating', withRating],
] as const;

const columns = async (): Promise<readonly string[]> => {
  const live = await adapter.schema.introspect({ namespace: migrationNamespace });
  return (
    live.tables.find((table) => table.name === 'library__book')?.columns.map((c) => c.name) ?? []
  );
};

describe('history, order and contract steps', () => {
  test('a file applied out of order is applied with a warning', async () => {
    const all = await filesThrough(initialThroughRating);
    expect(all.files.map((file) => file.id)).toEqual(['0001-initial', '0002-note', '0003-rating']);
    const [first, second, third] = all.files;
    if (first === undefined || second === undefined || third === undefined)
      throw new Error('files');
    await applyPending(adapter.schema, migrationNamespace, [
      { track: 'library', files: [first, third] },
    ]);
    const warnings: string[] = [];
    const result = await applyPending(adapter.schema, migrationNamespace, [all], {
      warn: (message) => warnings.push(message),
    });
    expect(result.applied).toEqual([{ track: 'library', id: '0002-note' }]);
    expect(warnings).toEqual([
      'library 0002-note is older than 0003-rating, which is already applied',
    ]);
    expect(await columns()).toEqual(expect.arrayContaining(['note', 'rating']));
  });

  test('a changed applied file is drift', async () => {
    const all = await filesThrough(initialThroughRating);
    const edited = all.files.map((file) =>
      file.id === '0002-note'
        ? {
            ...file,
            steps: [...file.steps, { op: 'rebuild' as const, entity: 'library.book', reason: 'x' }],
          }
        : file,
    );
    await expect(
      applyPending(adapter.schema, migrationNamespace, [{ track: 'library', files: edited }]),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await expect(
      applyPending(adapter.schema, migrationNamespace, [
        { track: 'library', files: all.files.slice(0, 2) },
      ]),
    ).rejects.toThrow(/0003-rating was applied but its file is gone/);
  });

  test('contract steps wait for the flag and for every live process to run this build', async () => {
    const track = await filesThrough([...initialThroughRating, ['drop-title', withoutTitle]]);
    expect(track.files.map((file) => file.id).at(-1)).toBe('0004-drop-title-contract');
    const waiting = await applyPending(adapter.schema, migrationNamespace, [track]);
    expect(waiting).toEqual({
      applied: [],
      deferred: [{ track: 'library', id: '0004-drop-title-contract' }],
    });
    expect(await columns()).toContain('title');
    await expect(
      applyPending(adapter.schema, migrationNamespace, [track], {
        contract: { buildId: 'b2', liveBuildIds: async () => ['b2', 'b1'] },
      }),
    ).rejects.toMatchObject({ code: 'core.rollout_not_finalized' });
    expect(await columns()).toContain('title');
    const done = await applyPending(adapter.schema, migrationNamespace, [track], {
      contract: { buildId: 'b2', liveBuildIds: async () => ['b2', 'b2'] },
    });
    expect(done.applied).toEqual([{ track: 'library', id: '0004-drop-title-contract' }]);
    expect(await columns()).not.toContain('title');
  });
});
