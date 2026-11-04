import { describe, expect, test } from 'vitest';
import { classifyContractSteps, diffSnapshots, planTrack } from '../../src/index.ts';
import { entryWithFields } from './support/entry-with-fields.ts';
import { fieldDescriptor } from './support/field-descriptor.ts';
import { libraryBook } from './support/library-book.ts';
import { libraryTrack } from './support/library-track.ts';
import { noRename } from './support/no-rename.ts';

const fields = libraryBook.descriptor.fields;
const base = libraryTrack(libraryBook, { library: 1 });
const grown = (extra: Record<string, ReturnType<typeof fieldDescriptor>>, drop: string[] = []) => {
  const kept = Object.fromEntries(Object.entries(fields).filter(([name]) => !drop.includes(name)));
  return libraryTrack(entryWithFields(libraryBook, { ...kept, ...extra }));
};

describe('diffSnapshots', () => {
  test('an unchanged snapshot has no steps', async () => {
    expect(await diffSnapshots(base, base, noRename)).toEqual({ steps: [], renames: [] });
    expect(
      await planTrack({ previous: base, desired: base, name: 'same', ask: noRename }),
    ).toBeNull();
  });

  test('a first snapshot creates its table without foreign keys, then adds them', async () => {
    const { steps } = await diffSnapshots(null, base, noRename);
    expect(steps.map((step) => step.op)).toEqual(['createTable']);
    const first = steps[0];
    expect(first?.op === 'createTable' && first.table.indexes.map((index) => index.name)).toContain(
      'library__book__isbn_uq',
    );
  });

  test('a required column on an existing table is added nullable and tightened by a contract step', async () => {
    const desired = grown({ pages: fieldDescriptor('pages', 'integer', { tag: 30 }) });
    const plan = await planTrack({ previous: base, desired, name: 'pages', ask: noRename });
    expect(plan?.files.map((file) => file.id)).toEqual(['0002-pages', '0003-pages-contract']);
    const [expand, contract] = plan?.files ?? [];
    expect(expand?.steps.map((step) => step.op)).toEqual(['addColumn']);
    expect(expand?.steps[0]).toMatchObject({ column: { name: 'pages', nullable: true } });
    expect(contract?.steps.map((step) => step.op)).toEqual(['alterColumn']);
    expect(plan?.snapshot.version).toBe(3);
  });

  test('a widening alterColumn is an expand step, a narrowing one a contract step', () => {
    const column = {
      name: 'title',
      field: 'title',
      kind: 'string' as const,
      nullable: false,
      default: null,
      constraints: { maxLength: 100 },
    };
    const step = (to: object) => ({
      op: 'alterColumn' as const,
      entity: 'library.book',
      field: 'title',
      from: column,
      to: { ...column, ...to },
    });
    expect(classifyContractSteps([step({ constraints: { maxLength: 200 } })]).contract).toEqual([]);
    expect(classifyContractSteps([step({ nullable: true })]).contract).toEqual([]);
    expect(classifyContractSteps([step({ constraints: { maxLength: 50 } })]).expand).toEqual([]);
    expect(classifyContractSteps([step({ kind: 'text' })]).expand).toEqual([]);
  });

  test('a removed and an added field of one kind ask for a rename', async () => {
    const desired = grown(
      {
        name: {
          ...fieldDescriptor('name', 'string', { tag: fields.title?.tag ?? 1 }),
          constraints: { maxLength: 200 },
        },
      },
      ['title'],
    );
    const asked: string[] = [];
    const plan = await planTrack({
      previous: base,
      desired,
      name: 'rename-title',
      ask: async (question) => {
        asked.push(`${question.entity}:${question.from}->${question.to}`);
        return true;
      },
    });
    expect(asked).toEqual(['library.book:title->name']);
    expect(plan?.files.map((file) => file.id)).toEqual([
      '0002-rename-title',
      '0003-rename-title-contract',
    ]);
    const [expand, contract] = plan?.files ?? [];
    expect(expand?.renames).toEqual([{ entity: 'library.book', from: 'title', to: 'name' }]);
    expect(expand?.steps.map((step) => step.op)).toEqual(['addColumn']);
    expect(contract?.steps.map((step) => step.op)).toEqual([
      'copyColumn',
      'alterColumn',
      'dropColumn',
    ]);
    expect(plan?.snapshot.entities['library.book']?.renames).toEqual([
      { from: 'title', to: 'name', file: '0002-rename-title' },
    ]);
  });

  test('a declined rename is a drop and an add', async () => {
    const desired = grown(
      { name: fieldDescriptor('name', 'string', { optional: true, tag: 40 }) },
      ['title'],
    );
    const { steps, renames } = await diffSnapshots(base, desired, noRename);
    expect(renames).toEqual([]);
    expect(steps.map((step) => step.op)).toEqual(['addColumn', 'dropColumn']);
  });

  test('a changed tag is refused with the tag to pin', async () => {
    const desired = grown({
      isbn: { ...(fields.isbn as ReturnType<typeof fieldDescriptor>), tag: 99 },
    });
    await expect(diffSnapshots(base, desired, noRename)).rejects.toThrow(/pin the old tag/);
  });

  test('a new index and a dropped one come as steps, a dropped table as a contract step', async () => {
    const indexed = grown({
      title: { ...(fields.title as ReturnType<typeof fieldDescriptor>), indexed: true },
    });
    const added = await diffSnapshots(base, indexed, noRename);
    expect(added.steps.map((step) => step.op)).toEqual(['createIndex']);
    const dropped = await diffSnapshots(indexed, base, noRename);
    expect(dropped.steps.map((step) => step.op)).toEqual(['dropIndex']);
    const gone = await diffSnapshots(base, { ...base, tables: [], entities: {} }, noRename);
    expect(gone.steps).toEqual([{ op: 'dropTable', entity: 'library.book' }]);
    expect(classifyContractSteps(gone.steps).contract).toHaveLength(1);
  });
});
