import type { BucketStore } from '@keelwerk/core';
import { bucketLevel } from '../sql/bucket-level.ts';
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
 * have refilled. A row dated ahead of the reading clock is never credited the difference (see
 * `bucketLevel`).
 */
export function memoryBucketStore(ctx: MemoryUnitContext): BucketStore {
  return {
    check: async (bucket, cost, limits) => {
      const { capacity, refillPerSecond } = limits;
      if (!(capacity > 0) || !(refillPerSecond > 0) || !(cost >= 0)) {
        throw malformedQuery(
          'a bucket needs a positive capacity and refill rate and a cost of at least 0',
        );
      }
      const existing = ctx.tx.read<Bucket>(`buckets/${ctx.scopeId()}`).get(bucket);
      return bucketLevel(existing, ctx.clock.now(), cost, limits).answer;
    },
    take: async (bucket, cost, limits) => {
      ctx.writable();
      const { capacity, refillPerSecond } = limits;
      if (!(capacity > 0) || !(refillPerSecond > 0) || !(cost >= 0)) {
        throw malformedQuery(
          'a bucket needs a positive capacity and refill rate and a cost of at least 0',
        );
      }
      const table = ctx.tx.write<Bucket>(`buckets/${ctx.scopeId()}`);
      const level = bucketLevel(table.get(bucket), ctx.clock.now(), cost, limits);
      table.set(bucket, {
        tokens: level.answer.ok ? level.available - cost : level.available,
        refilledAt: level.refilledAt,
      });
      return level.answer;
    },
  };
}
