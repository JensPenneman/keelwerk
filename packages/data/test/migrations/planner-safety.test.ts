import type { EntityEntry, FieldDescriptor, TrackSnapshot } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  buildTrackSnapshot,
  columnType,
  compareCatalogue,
  diffSnapshots,
  orderTracks,
  parseTrackId,
  renderStep,
  samePredicate,
  trackId,
} from '../../src/index.ts';
import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { conformanceEntries } from './support/conformance-entries.ts';
import { conformanceModules } from './support/conformance-modules.ts';
import { conformanceSnapshots } from './support/conformance-snapshots.ts';
import { conformanceTrackOfField } from './support/conformance-track-of-field.ts';
import { entryWithFields } from './support/entry-with-fields.ts';
import { fieldDescriptor } from './support/field-descriptor.ts';
import { migratingPglite } from './support/migrating-pglite.ts';
import { migrationNamespace } from './support/migration-namespace.ts';
import { noRename } from './support/no-rename.ts';
import { personalEntry } from './support/personal-entry.ts';

const snapshotOf = (entry: EntityEntry): TrackSnapshot =>
  buildTrackSnapshot([entry]).get('people') as TrackSnapshot;

describe('dropColumn drops the columns of one field only', () => {
  const field = (name: string): FieldDescriptor =>
    fieldDescriptor(name, 'decimal', { optional: true, constraints: { precision: 10, scale: 2 } });
  const before = snapshotOf(
    entryWithFields(personalEntry, { price: field('price'), priceValue: field('priceValue') }),
  );

  test('removing price keeps the column of the sibling field priceValue', async () => {
    const after = snapshotOf(entryWithFields(personalEntry, { priceValue: field('priceValue') }));
    const { steps } = await diffSnapshots(before, after, noRename);
    const drops = steps.filter((step) => step.op === 'dropColumn');
    expect(drops).toEqual([{ op: 'dropColumn', entity: 'people.person', field: 'price' }]);
    const sql = drops.flatMap((step) => renderStep('people', step));
    expect(sql).toEqual(['alter table "people"."people__person" drop column if exists "price"']);
  });

  test('removing one capability drops its tag column and not the sealed value', async () => {
    const full = snapshotOf(personalEntry);
    const table = full.tables[0];
    if (table === undefined) throw new Error('no table');
    const thinner: TrackSnapshot = {
      ...full,
      tables: [
        {
          ...table,
          columns: table.columns.filter((column) => column.name !== 'email__prefix'),
          indexes: table.indexes.filter((index) => !index.columns.includes('email__prefix')),
        },
      ],
    };
    const { steps } = await diffSnapshots(full, thinner, noRename);
    expect(steps.map((step) => step.op)).toEqual(['dropIndex', 'dropColumn']);
    expect(steps.at(-1)).toEqual({
      op: 'dropColumn',
      entity: 'people.person',
      field: 'email__prefix',
    });
    expect(renderStep('people', steps.at(-1) as never)).toEqual([
      'alter table "people"."people__person" drop column if exists "email__prefix"',
    ]);
  });
});

describe('personal index columns follow the registry names', () => {
  test('a contains column is smallint[] and an order field fails closed at snapshot time', () => {
    const table = snapshotOf(personalEntry).tables[0];
    const contains = table?.columns.find((column) => column.name === 'email__contains');
    expect(columnType(contains as never)).toBe('smallint[]');
    const ordered: EntityEntry = {
      ...personalEntry,
      descriptor: {
        ...personalEntry.descriptor,
        derivedIndexes: {
          ...personalEntry.descriptor.derivedIndexes,
          email__order: {
            field: 'email',
            kind: 'ore',
            query: 'order',
            column: 'email__order',
            keyVersion: 1,
          },
        },
      },
    };
    expect(() => buildTrackSnapshot([ordered])).toThrow(/ore/);
  });
});

describe('track ids agree with the registry', () => {
  test('every track the conformance registry names is rebuilt from its parts', () => {
    const ids = conformanceEntries.flatMap((entry) => entry.tracks.map((track) => track.track));
    expect(ids).toContain('loans[library]');
    for (const id of ids) {
      const { module, target, when } = parseTrackId(id);
      expect(trackId(module, target, when)).toBe(id);
    }
  });

  test('a multi-when conditional part has the id the registry gives (core track-id-of test)', () => {
    for (const id of ['auth[billing,teams]', 'auth->projects[billing,teams]']) {
      const { module, target, when } = parseTrackId(id);
      expect(trackId(module, target, when)).toBe(id);
      expect(trackId(module, target, [...when].reverse())).toBe(id);
    }
  });

  test('two orders of one when set give one id', () => {
    expect(trackId('auth', null, ['teams', 'billing'])).toBe(
      trackId('auth', null, ['billing', 'teams']),
    );
  });

  test('a conditional part without trackOfField is refused', () => {
    const loan = conformanceEntries.find((entry) => entry.ref === 'loans.loan');
    if (loan === undefined) throw new Error('no loans.loan');
    expect(() => buildTrackSnapshot([loan])).toThrow(/trackOfField/);
    expect(() =>
      buildTrackSnapshot([loan], { trackOfField: conformanceTrackOfField }),
    ).not.toThrow();
  });
});

describe('schema operations on PGlite', () => {
  let adapter: PgliteAdapter;
  const tracks = orderTracks(conformanceModules, [...conformanceSnapshots.keys()]);
  const snapshots = tracks.map((track) => conformanceSnapshots.get(track) as TrackSnapshot);
  const dialect = { typeOf: columnType, samePredicate };

  beforeAll(async () => {
    adapter = await migratingPglite();
  }, 60_000);

  afterAll(async () => {
    await adapter?.close(1000);
  }, 60_000);

  test('provision twice with the same snapshots changes nothing and does not throw', async () => {
    await adapter.schema.provision(migrationNamespace, snapshots);
    await adapter.schema.provision(migrationNamespace, snapshots);
    const live = await adapter.schema.introspect({ namespace: migrationNamespace });
    expect(compareCatalogue(snapshots, live, dialect)).toEqual([]);
  });

  test('a file with a data step is refused and not recorded', async () => {
    const file = {
      id: '0009-transform',
      track: 'library',
      steps: [],
      data: { entity: 'library.book', transform: () => null },
    };
    await expect(adapter.schema.apply(migrationNamespace, file)).rejects.toMatchObject({
      kind: 'unsupported',
    });
    const history = await adapter.schema.history(migrationNamespace);
    expect(history.map((row) => row.id)).not.toContain('0009-transform');
  });

  test('db check reports a table without forced row-level security or without its maintenance policy', async () => {
    const root = migrationNamespace.root;
    await adapter.asOwner(async (database) => {
      await database.query(`alter table ${root}.library__book no force row level security`);
      await database.query(`drop policy maintenance on ${root}.loans__loan`);
    });
    const live = await adapter.schema.introspect({ namespace: migrationNamespace });
    const found = compareCatalogue(snapshots, live, dialect).map(
      (difference) => `${difference.table} ${difference.kind}`,
    );
    expect(found.sort()).toEqual(['library__book rowSecurity', 'loans__loan missingPolicy']);
  });
});
