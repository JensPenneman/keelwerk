import type { ScopeTarget } from '../../src/invoker/scope-target.ts';
import type { BucketStore } from '../../src/storage/bucket-store.ts';
import type { DataAdapter } from '../../src/storage/data-adapter.ts';
import type { NamespaceRef } from '../../src/storage/namespace-ref.ts';
import type { Unit } from '../../src/storage/unit.ts';

/** A shared bucket table, and the units the adapter opened on it. */
export interface RateFake {
  readonly target: ScopeTarget;
  readonly levels: Map<string, number>;
  /** Every take and check the buckets answered, as `take:<key>:<cost>` and `check:<key>:<cost>`. */
  readonly calls: string[];
  /** Keys whose next take of a cost above 0 refuses once with a retryAfter of 7; the key leaves the set then. */
  readonly refuseNextTake: Set<string>;
  readonly units: { readWrite: number; readOnly: number };
}

/**
 * A scope target whose adapter keeps token levels in a map and counts its units. With a clock the
 * levels refill by the elapsed time at the limit's `refillPerSecond`, capped at its capacity (a
 * level the test sets is read as of the clock's next reading); without one they never refill. A
 * take of cost 0 opens the row at its level and changes no token count, as the stores do; a unit
 * whose function throws restores what its takes changed, as a rolled back transaction does.
 */
export function rateFake(namespaceId = 'ns-1', clock?: { now(): Temporal.Instant }): RateFake {
  const levels = new Map<string, number>();
  const readAt = new Map<string, Temporal.Instant>();
  const units = { readWrite: 0, readOnly: 0 };
  const calls: string[] = [];
  const refuseNextTake = new Set<string>();
  const levelOf = (bucket: string, limits: { capacity: number; refillPerSecond: number }) => {
    const level = levels.get(bucket) ?? limits.capacity;
    const at = readAt.get(bucket);
    if (clock === undefined || at === undefined) return level;
    const seconds = clock.now().since(at).total('seconds');
    return Math.min(limits.capacity, level + Math.max(0, seconds) * limits.refillPerSecond);
  };
  const buckets: BucketStore = {
    take: async (bucket, cost, limits) => {
      calls.push(`take:${bucket}:${cost}`);
      const level = levelOf(bucket, limits);
      if (clock !== undefined) readAt.set(bucket, clock.now());
      if (cost > 0 && refuseNextTake.delete(bucket)) {
        levels.set(bucket, level);
        return { ok: false, retryAfter: 7 };
      }
      if (level < cost) {
        levels.set(bucket, level);
        return { ok: false, retryAfter: 5 };
      }
      levels.set(bucket, level - cost);
      return { ok: true };
    },
    check: async (bucket, cost, limits) => {
      calls.push(`check:${bucket}:${cost}`);
      return levelOf(bucket, limits) < cost ? { ok: false, retryAfter: 5 } : { ok: true };
    },
    forget: async (names) => {
      readAt.clear();
      return names.filter((name) => levels.delete(name)).length;
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
      const savedLevels = new Map(levels);
      const savedReadAt = new Map(readAt);
      try {
        return await fn({ buckets } as unknown as Unit);
      } catch (error) {
        levels.clear();
        for (const [key, level] of savedLevels) levels.set(key, level);
        readAt.clear();
        for (const [key, at] of savedReadAt) readAt.set(key, at);
        throw error;
      }
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
  return { target, levels, calls, refuseNextTake, units };
}
