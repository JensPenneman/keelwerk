import type { KeyServiceOptions } from '../../src/keys/key-service-options.ts';
import type { ScopeKeyStore } from '../../src/storage/scope-key-store.ts';
import type { WrappedScopeKey } from '../../src/storage/wrapped-scope-key.ts';

/** The key service's runtime hooks over a plain map, and the rows behind them, for tests. */
export function memoryScopeKeys(): {
  readonly rows: WrappedScopeKey[];
  readonly calls: { count: number };
  readonly withScopeKeys: KeyServiceOptions['withScopeKeys'];
} {
  const rows: WrappedScopeKey[] = [];
  const calls = { count: 0 };
  const store: ScopeKeyStore = {
    current: async (scopeId) =>
      rows.filter((r) => r.scopeId === scopeId && r.retiredAt === null).at(-1),
    byVersion: async (scopeId, version) =>
      rows.find((r) => r.scopeId === scopeId && r.version === version),
    add: async (key) => {
      if (rows.some((r) => r.scopeId === key.scopeId && r.version === key.version)) {
        throw new Error('duplicate key');
      }
      rows.push(key);
    },
    retire: async () => undefined,
    destroy: async (scopeId) => {
      for (let i = rows.length - 1; i >= 0; i--)
        if (rows[i]?.scopeId === scopeId) rows.splice(i, 1);
    },
  };
  return {
    rows,
    calls,
    withScopeKeys: async (fn) => {
      calls.count++;
      return fn(store);
    },
  };
}
