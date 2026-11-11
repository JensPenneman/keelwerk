import { describe, expect, test } from 'vitest';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { UnitOptions } from '../storage/unit-options.ts';
import { createControlFlags } from './create-control-flags.ts';

const stored: StorageRow = {
  id: 'flg-1',
  key: 'shop.limit',
  backendId: null,
  version: 4,
  targeting: { enabled: true },
};

function over() {
  const opened: (UnitOptions | undefined)[] = [];
  const queries: unknown[] = [];
  const unit = {
    rows: {
      find: async (_descriptor: unknown, query: unknown) => {
        queries.push(query);
        return { rows: [stored], pageInfo: { hasNextPage: false, endCursor: null } };
      },
    },
  };
  const adapter = {
    unit: async (
      _namespace: unknown,
      _scope: unknown,
      run: (unit: unknown) => Promise<unknown>,
      options?: UnitOptions,
    ) => {
      opened.push(options);
      return run(unit);
    },
  } as unknown as DataAdapter;
  const registry = {
    entities: new Map([['core.flag', { descriptor: {} }]]),
  } as unknown as Registry;
  const flags = createControlFlags({
    adapter,
    namespace: { id: 'ns-control' } as unknown as NamespaceRef,
    registry,
  });
  return { flags, opened, queries };
}

describe('createControlFlags', () => {
  test('every read is a read-only unit with a time bound, so a read that hangs ends in the store', async () => {
    const { flags, opened } = over();
    await flags.rows();
    await flags.row('flg-1');
    expect(opened).toEqual([
      { readOnly: true, timeoutMs: 5_000 },
      { readOnly: true, timeoutMs: 5_000 },
    ]);
  });

  test('row() reads the one row by its id and answers it in the cache form', async () => {
    const { flags, queries } = over();
    expect(await flags.row('flg-1')).toEqual({
      id: 'flg-1',
      key: 'shop.limit',
      backendId: null,
      version: 4,
      targeting: { enabled: true },
    });
    expect(queries).toEqual([
      { where: { op: 'eq', field: 'id', value: 'flg-1' }, page: { first: 1 } },
    ]);
  });
});
