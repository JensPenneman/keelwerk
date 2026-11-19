import type { ScopeTarget } from '../../src/invoker/scope-target.ts';
import type { BucketStore } from '../../src/storage/bucket-store.ts';
import type { DataAdapter } from '../../src/storage/data-adapter.ts';
import type { NamespaceRef } from '../../src/storage/namespace-ref.ts';
import type { Unit } from '../../src/storage/unit.ts';

/** A shared bucket table without refill, and the units the adapter opened on it. */
export interface RateFake {
  readonly target: ScopeTarget;
  readonly levels: Map<string, number>;
  readonly units: { readWrite: number; readOnly: number };
}

/** A scope target whose adapter keeps token levels in a map and counts its units. */
export function rateFake(namespaceId = 'ns-1'): RateFake {
  const levels = new Map<string, number>();
  const units = { readWrite: 0, readOnly: 0 };
  const buckets: BucketStore = {
    take: async (bucket, cost, limits) => {
      const level = levels.get(bucket) ?? limits.capacity;
      if (level < cost) return { ok: false, retryAfter: 5 };
      levels.set(bucket, level - cost);
      return { ok: true };
    },
    check: async (bucket, cost, limits) => {
      const level = levels.get(bucket) ?? limits.capacity;
      return level < cost ? { ok: false, retryAfter: 5 } : { ok: true };
    },
  };
  const adapter = {
    unit: async (
      _namespace: NamespaceRef,
      _scope: unknown,
      fn: (unit: Unit) => Promise<unknown>,
      options?: { readOnly?: boolean },
    ) => {
      if (options?.readOnly === true) units.readOnly += 1;
      else units.readWrite += 1;
      return fn({ buckets } as unknown as Unit);
    },
  } as unknown as DataAdapter;
  const target = {
    scope: {
      level: 'tenant',
      backendId: '00000000-0000-4000-8000-0000000000b1',
      tenantId: '00000000-0000-4000-8000-0000000000a1',
    },
    namespace: { id: namespaceId } as NamespaceRef,
    handle: { adapter },
  } as unknown as ScopeTarget;
  return { target, levels, units };
}
