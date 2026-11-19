import { describe, expect, test } from 'vitest';
import { backendQuotasOf } from '../quotas/backend-quotas-of.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { UnitOptions } from '../storage/unit-options.ts';
import { readBackendQuotas } from './read-backend-quotas.ts';

const namespace = { id: 'ns-control' } as unknown as NamespaceRef;

function backend(index: number, config: unknown): StorageRow {
  return { id: `bkd-${String(index).padStart(4, '0')}`, config } as StorageRow;
}

function over(all: readonly StorageRow[], pageSize = 2) {
  const opened: { scope: unknown; options: UnitOptions | undefined }[] = [];
  const queries: {
    sort?: unknown;
    select?: unknown;
    includeArchived?: unknown;
    page?: { first: number; after?: string };
  }[] = [];
  const unit = {
    rows: {
      find: async (_descriptor: unknown, query: { page: { first: number; after?: string } }) => {
        queries.push(query);
        const from = query.page.after === undefined ? 0 : Number(query.page.after);
        const rows = all.slice(from, from + pageSize);
        const next = from + rows.length;
        return {
          rows,
          pageInfo: {
            hasNextPage: next < all.length,
            endCursor: next < all.length ? String(next) : null,
          },
        };
      },
    },
  };
  const adapter = {
    unit: async (
      _namespace: unknown,
      scope: unknown,
      run: (unit: unknown) => Promise<unknown>,
      options?: UnitOptions,
    ) => {
      opened.push({ scope, options });
      return run(unit);
    },
  } as unknown as DataAdapter;
  const registry = {
    entities: new Map([['core.backend', { descriptor: {} }]]),
  } as unknown as Registry;
  return { read: () => readBackendQuotas({ adapter, namespace, registry }), opened, queries };
}

const withQuotas = (quotas: unknown) => ({ core: { quotas } });

describe('readBackendQuotas', () => {
  test('reads the pages of the backends with the cursor of the page before', async () => {
    const { read, opened, queries } = over([
      backend(1, withQuotas({ 'notes.rows': '4' })),
      backend(2, undefined),
      backend(3, withQuotas({ 'queue:commands.weight': '2', 'notes.rows': '9' })),
    ]);
    const found = await read();
    expect([...found.keys()]).toEqual(['bkd-0001', 'bkd-0003']);
    expect(found.get('bkd-0003')).toEqual(
      new Map([
        ['queue:commands.weight', '2'],
        ['notes.rows', '9'],
      ]),
    );
    expect(queries.map((query) => query.page)).toEqual([
      { first: 500 },
      { first: 500, after: '2' },
    ]);
    for (const query of queries) {
      expect(query.sort).toEqual([{ field: 'id', direction: 'asc' }]);
      expect(query.select).toEqual(['config']);
      expect(query.includeArchived).toBe(true);
    }
    expect(opened).toEqual([
      { scope: { level: 'deployment' }, options: { readOnly: true, timeoutMs: 5_000 } },
    ]);
  });

  test('a registry without core.backend answers none', async () => {
    const adapter = {
      unit: async (_n: unknown, _s: unknown, run: (unit: unknown) => Promise<unknown>) => run({}),
    } as unknown as DataAdapter;
    const registry = { entities: new Map() } as unknown as Registry;
    expect(await readBackendQuotas({ adapter, namespace, registry })).toEqual(new Map());
  });
});

describe('backendQuotasOf', () => {
  test('keeps the own string members of config.core.quotas and drops anything else', () => {
    expect(backendQuotasOf(withQuotas({ a: '1', b: 2, c: null }))).toEqual(new Map([['a', '1']]));
    for (const config of [
      undefined,
      null,
      'x',
      {},
      { core: 3 },
      { core: {} },
      withQuotas([1]),
      withQuotas('x'),
    ]) {
      expect(backendQuotasOf(config)).toEqual(new Map());
    }
  });
});
