import type { BucketStore } from '@keelwerk/core';
import { malformedQuery } from '../sql/malformed-query.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

interface Bucket {
  readonly tokens: number;
  readonly refilledAt: Temporal.Instant;
}

/**
 * The shared token buckets of the unit's scope (S-36): created full at `capacity`, refilled by
 * time up to `capacity`, one take per call. The key is the keyed hash the caller derived; the
 * store never sees the plain identifier. A refused take reports the seconds until enough tokens
 * have refilled.
 */
export function memoryBucketStore(ctx: MemoryUnitContext): BucketStore {
  return {
    take: async (bucket, cost, limits) => {
      ctx.writable();
      const { capacity, refillPerSecond } = limits;
      if (!(capacity > 0) || !(refillPerSecond > 0) || !(cost >= 0)) {
        throw malformedQuery(
          'a bucket needs a positive capacity and refill rate and a cost of at least 0',
        );
      }
      const table = ctx.tx.write<Bucket>(`buckets/${ctx.scopeId()}`);
      const now = ctx.clock.now();
      const existing = table.get(bucket);
      const elapsed =
        existing === undefined
          ? 0
          : Math.max(0, now.epochMilliseconds - existing.refilledAt.epochMilliseconds) / 1000;
      const available =
        existing === undefined
          ? capacity
          : Math.min(capacity, existing.tokens + elapsed * refillPerSecond);
      if (available >= cost) {
        table.set(bucket, { tokens: available - cost, refilledAt: now });
        return { ok: true };
      }
      table.set(bucket, { tokens: available, refilledAt: now });
      return { ok: false, retryAfter: (cost - available) / refillPerSecond };
    },
  };
}
