import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TrackSnapshot } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  buildTrackSnapshot,
  columnType,
  compareCatalogue,
  diffSnapshots,
  loadMigrations,
  migrationChecksum,
  parseSnapshot,
  renderMigrationFile,
  renderSnapshot,
  renderStep,
  samePredicate,
  snapshotFormat,
  trackDirectoryName,
} from '../../src/index.ts';
import { conformanceSnapshots } from './support/conformance-snapshots.ts';
import { migratingPglite } from './support/migrating-pglite.ts';
import { migrationNamespace } from './support/migration-namespace.ts';
import { noRename } from './support/no-rename.ts';
import { personalEntry } from './support/personal-entry.ts';

const snapshot = buildTrackSnapshot([personalEntry]).get('people') as TrackSnapshot;

describe('personal and CRDT fields', () => {
  test('a personal field is a sealed bytea plus its tag columns, unique on the equality tag', () => {
    const table = snapshot.tables[0];
    const byName = new Map(table?.columns.map((column) => [column.name, column]));
    expect(byName.get('email')).toMatchObject({ kind: 'sealed', nullable: true });
    expect(columnType(byName.get('email__eq') as never)).toBe('bytea');
    expect(columnType(byName.get('email__prefix') as never)).toBe('bigint[]');
    expect(columnType(byName.get('email__contains') as never)).toBe('smallint[]');
    expect(columnType(byName.get('body') as never)).toBe('bytea');
    expect(byName.get('body_value')).toMatchObject({ kind: 'text' });
    expect(columnType(byName.get('price') as never)).toBe('numeric(10,2)');
    const indexes = new Map(table?.indexes.map((index) => [index.name, index]));
    expect(indexes.get('people__person__email__eq_uq')).toMatchObject({
      unique: true,
      columns: ['backend_id', 'email__eq'],
      where: { op: 'isNull', field: 'archivedAt', value: true },
    });
    expect(indexes.get('people__person__email__prefix_ix')).toMatchObject({ method: 'gin' });
  });

  test('applied on PGlite and read back, the tables equal their snapshot', async () => {
    const adapter = await migratingPglite();
    try {
      const { steps } = await diffSnapshots(null, snapshot, noRename);
      await adapter.schema.apply(migrationNamespace, {
        id: '0001-initial',
        track: 'people',
        steps,
      });
      const live = await adapter.schema.introspect({ namespace: migrationNamespace });
      const dialect = { typeOf: columnType, samePredicate };
      expect(compareCatalogue([snapshot], live, dialect)).toEqual([]);
      await adapter.asOwner(async (database) => {
        await database.query(`drop index ${migrationNamespace.root}.people__person__email__eq_uq`);
        await database.query(
          `alter table ${migrationNamespace.root}.people__person add column stray text`,
        );
        await database.query(
          `alter table ${migrationNamespace.root}.people__person disable row level security`,
        );
        await database.query(`drop policy scoped on ${migrationNamespace.root}.people__person`);
        await database.query(
          `alter table ${migrationNamespace.root}.people__person alter column price type numeric(12,2)`,
        );
      });
      const tampered = await adapter.schema.introspect({ namespace: migrationNamespace });
      const kinds = compareCatalogue([snapshot], tampered, dialect).map(
        (difference) => difference.kind,
      );
      expect(kinds.sort()).toEqual([
        'columnType',
        'extraColumn',
        'missingIndex',
        'missingPolicy',
        'rowSecurity',
      ]);
    } finally {
      await adapter.close(1000);
    }
  }, 60_000);

  test('rendering shows the statements without running them, and the ore type fails closed', () => {
    const statements = renderStep('people', {
      op: 'dropColumn',
      entity: 'people.person',
      field: 'email',
    });
    expect(statements[0]).toBe(
      'alter table "people"."people__person" drop column if exists "email"',
    );
    expect(statements).toHaveLength(1);
    expect(() =>
      renderStep('people', {
        op: 'addColumn',
        entity: 'people.person',
        field: 'email',
        column: {
          name: 'email__ore',
          field: 'email',
          kind: 'tags',
          nullable: true,
          default: null,
          constraints: {},
        },
      }),
    ).toThrow(/ore/);
    expect(() => renderStep('people', { op: 'sql', statements: { mysql: ['select 1'] } })).toThrow(
      /postgres/,
    );
  });
});

describe('stored formats', () => {
  test('a snapshot renders sorted, LF, with a trailing newline, and parses back equal', () => {
    for (const each of [snapshot, ...conformanceSnapshots.values()]) {
      const text = renderSnapshot(each);
      expect(text.endsWith('\n')).toBe(true);
      expect(text).not.toContain('\r');
      expect(JSON.parse(text).format).toBe(snapshotFormat);
      expect(parseSnapshot(text)).toEqual(each);
      expect(renderSnapshot(parseSnapshot(text))).toBe(text);
    }
    expect(snapshotFormat).toBe('keelwerk.snapshot/1');
  });

  test('a bigint bound survives the snapshot', () => {
    const entity = snapshot.entities['people.person'];
    const bounded = {
      ...snapshot,
      entities: {
        'people.person': {
          ...(entity as NonNullable<typeof entity>),
          fields: {
            n: { ...(entity?.fields.price as never as object), constraints: { max: 2n ** 70n } },
          },
        },
      },
    } as unknown as TrackSnapshot;
    expect(parseSnapshot(renderSnapshot(bounded))).toEqual(bounded);
  });

  test('another format is refused', () => {
    expect(() => parseSnapshot('{"format":"keelwerk.snapshot/2"}')).toThrow(TypeError);
  });

  test('the checksum covers the steps only and is stable', async () => {
    const { steps } = await diffSnapshots(null, snapshot, noRename);
    expect(migrationChecksum(steps)).toMatch(/^[0-9a-f]{64}$/);
    expect(migrationChecksum(steps)).toBe(migrationChecksum(JSON.parse(JSON.stringify(steps))));
    expect(migrationChecksum(steps.slice(1))).not.toBe(migrationChecksum(steps));
  });

  test('a rendered file loads back from disk with its snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keelwerk-migrations-'));
    const { steps } = await diffSnapshots(null, snapshot, noRename);
    const directory = join(root, trackDirectoryName('people'));
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, '0001-initial.ts'),
      renderMigrationFile({ id: '0001-initial', track: 'people', steps }),
    );
    await writeFile(join(directory, 'snapshot.json'), renderSnapshot(snapshot));
    const loaded = await loadMigrations('people', new URL(`file://${root}`));
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.track).toBe('people');
    expect(loaded[0]?.snapshot).toEqual(snapshot);
    expect(loaded[0]?.files[0]?.steps).toEqual(JSON.parse(JSON.stringify(steps)));
    expect(await loadMigrations('people', new URL(`file://${root}/missing/`))).toEqual([]);
  });

  test('a file whose id does not match its name is refused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keelwerk-migrations-'));
    await mkdir(join(root, 'own'), { recursive: true });
    await writeFile(
      join(root, 'own', '0002-other.ts'),
      renderMigrationFile({ id: '0001-initial', track: 'people', steps: [] }),
    );
    await expect(loadMigrations('people', new URL(`file://${root}/`))).rejects.toThrow(
      /expected people 0002-other/,
    );
  });
});
