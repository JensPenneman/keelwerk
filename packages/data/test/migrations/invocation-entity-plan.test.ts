import { defineApp } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { buildTrackSnapshot } from '../../src/index.ts';
import { fieldDescriptor } from './support/field-descriptor.ts';
import { invocationEntry } from './support/invocation-entry.ts';

describe('an invocation entity in the tracks', () => {
  test('an invocation entity of a module is planned as an invocation table', () => {
    const snapshots = buildTrackSnapshot([invocationEntry()]);
    const table = snapshots
      .get('notes')
      ?.tables.find((candidate) => candidate.name === 'notes__stamp');
    expect(table?.primaryKey).toEqual(['scope_id', 'id']);
    expect(table?.scoped).toBe('tenant');
    expect(table?.foreignKeys).toEqual([]);
    const names = table?.columns.map((column) => column.name);
    expect(names?.slice(0, 5)).toEqual(['scope_id', 'id', 'created_at', 'updated_at', 'version']);
    expect(names).toEqual(expect.arrayContaining(['token', 'seen_at']));
    expect(
      names?.some(
        (name) => name === 'tenant_id' || name === 'archived_at' || name.startsWith('kw_'),
      ),
    ).toBe(false);
    // A unique index holds no archived predicate: the table has no archived_at.
    expect(table?.indexes).toEqual([
      expect.objectContaining({
        columns: ['scope_id', 'token'],
        unique: true,
        where: null,
      }),
      expect.objectContaining({ columns: ['scope_id', 'seen_at'], unique: false, where: null }),
    ]);
    expect(snapshots.get('notes')?.entities['notes.stamp']).toMatchObject({
      history: 'state',
      fields: { token: expect.anything(), seenAt: expect.anything() },
    });
  });

  test("the core's receipts and effect records stay out of every track", () => {
    const registry = defineApp({ id: 'plain', modules: [] }).registry;
    const core = [...registry.entities.values()].filter((entry) => entry.module === 'core');
    const invocation = core.filter((entry) => entry.descriptor.tenancy === 'invocation');
    expect(invocation.length).toBeGreaterThan(0);
    const snapshots = buildTrackSnapshot([...registry.entities.values()]);
    for (const snapshot of snapshots.values()) {
      for (const entry of invocation) {
        expect(snapshot.tables.map((table) => table.name)).not.toContain(entry.descriptor.table);
        expect(Object.keys(snapshot.entities)).not.toContain(entry.ref);
      }
      expect(snapshot.tables.some((table) => table.primaryKey[0] === 'scope_id')).toBe(false);
    }
  });

  describe('what its table cannot hold is unsupported, by name', () => {
    const unsupported = [
      [
        'a derived index',
        {
          descriptor: {
            derivedIndexes: {
              token_eq: { field: 'token', query: 'eq', kind: 'blind', column: 'kw_token_eq' },
            },
          },
        },
      ],
      [
        'a search index',
        {
          descriptor: {
            searchIndexes: [
              { name: 'text', fields: ['token'], form: 'tokens', keys: null, languages: [] },
            ],
          },
        },
      ],
      [
        'a hard reference',
        {
          fields: {
            owner: fieldDescriptor('owner', 'ref', {
              ref: { entity: 'notes.owner', foreignKey: true },
              tag: 3,
            }),
          },
        },
      ],
      ['the history', { descriptor: { history: 'chain' } }],
      ['a merge state', { descriptor: { mergeState: true } }],
      ['a generated archive action', { generated: ['archive'] }],
      ['a generated restore action', { generated: ['restore'] }],
      [
        'the personal field',
        {
          fields: {
            owner: fieldDescriptor('owner', 'string', {
              tag: 3,
              personal: {
                subject: 'id',
                queries: [],
                normalize: { id: 'exact', version: 1 },
                params: {
                  eq: { bits: 128 },
                  prefix: { min: 2, max: 8 },
                  contains: { bits: 32 },
                  order: { bytes: 8 },
                },
                keys: 'tenant',
              },
            }),
          },
        },
      ],
      [
        'the index',
        {
          descriptor: {
            indexes: [
              {
                name: 'notes__stamp_live_ix',
                fields: ['seenAt'],
                unique: false,
                where: { op: 'isNull', field: 'archivedAt', value: true },
              },
            ],
          },
        },
      ],
    ] as const;
    test.each(unsupported)('%s', (what, options) => {
      expect(() => buildTrackSnapshot([invocationEntry(options as never)])).toThrow(
        expect.objectContaining({
          kind: 'unsupported',
          message: expect.stringContaining(
            `notes.stamp has invocation tenancy and cannot have ${what}`,
          ),
        }),
      );
    });

    test('a field of another track', () => {
      expect(() =>
        buildTrackSnapshot([invocationEntry()], {
          trackOfField: (_entry, name) => (name === 'seenAt' ? 'extra' : 'notes'),
        }),
      ).toThrow(
        expect.objectContaining({
          kind: 'unsupported',
          message: expect.stringContaining(
            'notes.stamp has invocation tenancy and cannot have the field seenAt',
          ),
        }),
      );
    });
  });
});
