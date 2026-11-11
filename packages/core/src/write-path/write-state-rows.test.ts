import { describe, expect, test } from 'vitest';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { writeStateRows } from './write-state-rows.ts';
import type { WrittenRow } from './written-row.ts';

function entryOf(tenancy: 'tenant' | 'invocation'): EntityEntry {
  return { ref: 'x.y', descriptor: { tenancy } } as unknown as EntityEntry;
}

function item(tenancy: 'tenant' | 'invocation', created: boolean): WrittenRow {
  return {
    entry: entryOf(tenancy),
    id: 'r1',
    created,
    loadedVersion: 1,
    row: { id: 'r1', status: 'x', kwLastHlc: 'h', kwLastHash: 'a', kwErasedAt: null, version: 2 },
  } as unknown as WrittenRow;
}

function capturing(): { readonly unit: Unit; readonly written: StorageRow[] } {
  const written: StorageRow[] = [];
  const unit = {
    rows: {
      insert: (_entity: unknown, rows: readonly StorageRow[]) => {
        written.push(...rows);
        return Promise.resolve();
      },
      update: (_entity: unknown, changes: readonly { readonly values: StorageRow }[]) => {
        written.push(...changes.map((change) => change.values));
        return Promise.resolve();
      },
    },
  } as unknown as Unit;
  return { unit, written };
}

describe('writeStateRows', () => {
  test.each([true, false])(
    'an invocation row reaches unit.rows without the framework columns (created: %s)',
    async (created) => {
      const { unit, written } = capturing();
      await writeStateRows(unit, [item('invocation', created)]);
      expect(written).toEqual([{ id: 'r1', status: 'x', version: 2 }]);
    },
  );

  test('a tenant row keeps them', async () => {
    const { unit, written } = capturing();
    await writeStateRows(unit, [item('tenant', true)]);
    expect(Object.keys(written[0] ?? {})).toContain('kwLastHash');
  });
});
