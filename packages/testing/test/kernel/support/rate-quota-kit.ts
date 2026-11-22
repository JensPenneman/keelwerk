import type { DataAdapter, QuotaLimit, QuotaLimits } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { tenantId } from './invoker-kit.ts';

/** The quotas the request rate of an invocation reads. */
const requestRates: ReadonlySet<string> = new Set([
  'core.principalRequestRate',
  'core.commandRate',
  'core.queryRate',
  'core.subscribeRate',
  'core.requestRate',
]);

/** Quotas whose rates give the tenant `capacities` by ref (100 where none is named) and every other scope 100. */
export const tenantOnly = (capacities: Readonly<Record<string, number>>): QuotaLimits => ({
  limitOf: (_registry, scope, ref): QuotaLimit => {
    const own = scope.level === 'tenant' && scope.tenantId === tenantId;
    const capacity = own ? (capacities[ref] ?? 100) : 100;
    return { kind: 'rate', capacity, refillPerSecond: 0.001 };
  },
  queueOf: () => ({ running: 4, queued: 10_000, weight: 1 }),
  fresh: () => Promise.resolve(),
});

/**
 * `limitOf` of a test that sets storage limits, with the request rate it does not test given a
 * limit: an invocation reads three rates and refuses a limit that is not one. Without `capacities`
 * the rate is one no test reaches; with them each rate has the capacity named by its ref, or 15,
 * refilling 0.001 a second, so that no draw of the allowance holds a token beyond the one it spends
 * (a capacity under 20 draws 1) and a clock that stands still refills nothing.
 */
export const withRequestRates =
  (
    limitOf: QuotaLimits['limitOf'],
    capacities?: Readonly<Record<string, number>>,
  ): QuotaLimits['limitOf'] =>
  (registry, scope, ref) => {
    if (!requestRates.has(ref)) return limitOf(registry, scope, ref);
    return capacities === undefined
      ? { kind: 'rate', capacity: 1_000_000, refillPerSecond: 1_000_000 }
      : { kind: 'rate', capacity: capacities[ref] ?? 15, refillPerSecond: 0.001 };
  };

/**
 * An adapter that counts the tokens its bucket stores gave: the cost of every take that was
 * granted, by stored bucket name. A take of cost 0 (a lock) and a refused take count nothing, and
 * a unit that fails gives its tokens back. `away('unit')` makes the next read-write unit fail before it runs,
 * `away('take')` the next take of a bucket, as a database that is away does: with
 * `core.unavailable`.
 */
export function tokensTaken(inner: DataAdapter): {
  readonly adapter: DataAdapter;
  readonly taken: () => ReadonlyMap<string, number>;
  readonly away: (where: 'unit' | 'take') => void;
} {
  const committed = new Map<string, number>();
  let awayAt: 'unit' | 'take' | undefined;
  const gone = () => errors.unavailable('The store is away.');
  const adapter: DataAdapter = {
    ...inner,
    unit: async (namespace, scope, fn, options) => {
      if (awayAt === 'unit' && options?.readOnly !== true) {
        awayAt = undefined;
        throw gone();
      }
      const pending = new Map<string, number>();
      const result = await inner.unit(
        namespace,
        scope,
        (unit) =>
          fn({
            ...unit,
            buckets: {
              ...unit.buckets,
              take: async (bucket, cost, limits) => {
                if (awayAt === 'take') {
                  awayAt = undefined;
                  throw gone();
                }
                const answer = await unit.buckets.take(bucket, cost, limits);
                if (answer.ok && cost > 0) pending.set(bucket, (pending.get(bucket) ?? 0) + cost);
                return answer;
              },
            },
          }),
        options,
      );
      for (const [bucket, cost] of pending) {
        committed.set(bucket, (committed.get(bucket) ?? 0) + cost);
      }
      return result;
    },
  };
  return {
    adapter,
    taken: () => new Map(committed),
    away: (where) => {
      awayAt = where;
    },
  };
}
