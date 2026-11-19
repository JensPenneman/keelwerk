import type { ScopeTarget } from '../../src/invoker/scope-target.ts';
import type { BucketStore } from '../../src/storage/bucket-store.ts';
import type { DataAdapter } from '../../src/storage/data-adapter.ts';
import type { NamespaceRef } from '../../src/storage/namespace-ref.ts';
import type { Unit } from '../../src/storage/unit.ts';

/** A shared bucket table, and the units the adapter opened on it. */
export interface RateFake {
  readonly target: ScopeTarget;
  readonly levels: Map<string, number>;
  readonly units: { readWrite: number; readOnly: number };
}

/**
 * A scope target whose adapter keeps token levels in a map and counts its units. With a clock the
 * levels refill by the elapsed time at the limit's `refillPerSecond`, capped at its capacity (a
 * level the test sets is read as of the clock's next reading); without one they never refill.
 */
export function rateFake(namespaceId = 'ns-1', clock?: { now(): Temporal.Instant }): RateFake {
  const levels = new Map<string, number>();
  const readAt = new Map<string, Temporal.Instant>();
  const units = { readWrite: 0, readOnly: 0 };
  const levelOf = (bucket: string, limits: { capacity: number; refillPerSecond: number }) => {
    const level = levels.get(bucket) ?? limits.capacity;
    const at = readAt.get(bucket);
    if (clock === undefined || at === undefined) return level;
    const seconds = clock.now().since(at).total('seconds');
    return Math.min(limits.capacity, level + Math.max(0, seconds) * limits.refillPerSecond);
  };
  const buckets: BucketStore = {
    take: async (bucket, cost, limits) => {
      const level = levelOf(bucket, limits);
      if (clock !== undefined) readAt.set(bucket, clock.now());
      if (level < cost) {
        levels.set(bucket, level);
        return { ok: false, retryAfter: 5 };
      }
      levels.set(bucket, level - cost);
      return { ok: true };
    },
    check: async (bucket, cost, limits) => {
      return levelOf(bucket, limits) < cost ? { ok: false, retryAfter: 5 } : { ok: true };
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
