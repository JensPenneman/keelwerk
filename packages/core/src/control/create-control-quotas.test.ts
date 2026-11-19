import { describe, expect, test } from 'vitest';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { UnitOptions } from '../storage/unit-options.ts';
import { createControlQuotas } from './create-control-quotas.ts';

const namespace = { id: 'ns-control' } as unknown as NamespaceRef;

function storedRow(index: number, extra: Partial<StorageRow> = {}): StorageRow {
  const id = `qta-${String(index).padStart(4, '0')}`;
  return {
    id,
    slot: `core.rows@b1@${id}`,
    dimension: 'core.rows',
    backendId: 'b1',
    tenantId: id,
    limit: '100',
    version: 2,
    ...extra,
  };
}

function over(all: readonly StorageRow[]) {
  const opened: { scope: unknown; options: UnitOptions | undefined }[] = [];
  const queries: { sort?: unknown; page?: { first: number; after?: string } }[] = [];
  const wakes: unknown[][] = [];
  const unit = {
    rows: {
      find: async (_descriptor: unknown, query: { page: { first: number; after?: string } }) => {
        queries.push(query);
        const from = query.page.after === undefined ? 0 : Number(query.page.after);
        const rows = all.slice(from, from + query.page.first);
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
    feed: {
      wake: (namespaces: readonly unknown[], _signal: AbortSignal) => {
        wakes.push([...namespaces]);
        return (async function* () {
          yield 'wake-1';
          yield 'wake-2';
        })();
      },
    },
  } as unknown as DataAdapter;
  const registry = {
    entities: new Map([['core.quota', { descriptor: {} }]]),
  } as unknown as Registry;
  return { quotas: createControlQuotas({ adapter, namespace, registry }), opened, queries, wakes };
}

describe('createControlQuotas', () => {
  test('reads every row in pages of 500 by id in one read-only deployment unit within the read bound', async () => {
    const { quotas, opened, queries } = over(
      Array.from({ length: 1201 }, (_, index) => storedRow(index)),
    );
    const rows = await quotas.rows();
    expect(rows).toHaveLength(1201);
    expect(rows[0]).toEqual({
      id: 'qta-0000',
      slot: 'core.rows@b1@qta-0000',
      dimension: 'core.rows',
      backendId: 'b1',
      tenantId: 'qta-0000',
      limit: '100',
      version: 2,
    });
    expect(opened).toEqual([
      { scope: { level: 'deployment' }, options: { readOnly: true, timeoutMs: 5_000 } },
    ]);
    expect(queries.map((query) => query.page)).toEqual([
      { first: 500 },
      { first: 500, after: '500' },
      { first: 500, after: '1000' },
    ]);
    for (const query of queries) {
      expect(query.sort).toEqual([{ field: 'id', direction: 'asc' }]);
    }
  });

  test('absent tenant and limit read as null', async () => {
    const { quotas } = over([
      storedRow(1, { tenantId: null, limit: null }),
      storedRow(2, { tenantId: undefined, limit: undefined }),
    ]);
    const rows = await quotas.rows();
    expect(rows.map((row) => [row.tenantId, row.limit])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  test('changes yields the feed wakes of the control namespace', async () => {
    const { quotas, wakes } = over([]);
    const seen: unknown[] = [];
    for await (const wake of quotas.changes(new AbortController().signal)) seen.push(wake);
    expect(seen).toEqual(['wake-1', 'wake-2']);
    expect(wakes).toEqual([[namespace]]);
  });

  test('a registry without core.quota has no rows', async () => {
    const adapter = {
      unit: async (_n: unknown, _s: unknown, run: (unit: unknown) => Promise<unknown>) => run({}),
    } as unknown as DataAdapter;
    const registry = { entities: new Map() } as unknown as Registry;
    expect(await createControlQuotas({ adapter, namespace, registry }).rows()).toEqual([]);
  });
});
