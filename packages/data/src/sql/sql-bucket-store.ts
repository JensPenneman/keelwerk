// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { BucketStore } from '@keelwerk/core';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { malformedQuery } from './malformed-query.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * The shared token buckets of the unit's scope (S-36): created full at `capacity`, refilled by
 * time up to `capacity`, one take per call. The caller passes the keyed hash of the bucket key as
 * `bucket` and the store keeps its UTF-8 bytes; it never sees the plain identifier. The row is
 * locked from the read to the write, so concurrent takes of one bucket queue up, and a refused
 * take reports the seconds until enough tokens have refilled.
 */
export function sqlBucketStore(ctx: SqlUnitContext): BucketStore {
  const table = ctx.table('kw_rate_buckets');
  return {
    take: async (bucket, cost, limits) => {
      ctx.writable();
      const { capacity, refillPerSecond } = limits;
      if (!(capacity > 0) || !(refillPerSecond > 0) || !(cost >= 0)) {
        throw malformedQuery(
          'a bucket needs a positive capacity and refill rate and a cost of at least 0',
        );
      }
      const key = Buffer.from(bucket, 'utf8');
      const now = ctx.clock.now();
      const db = ctx.scopedDb();
      return sqlGuard(async () => {
        await db
          .insertInto(table)
          .values({ bucket: key, tokens: capacity, refilled_at: encodeInstant(now) })
          .onConflict((conflict) => conflict.columns(['scope_id', 'bucket']).doNothing())
          .execute();
        const row = await db
          .selectFrom(table)
          .select(['tokens', 'refilled_at'])
          .where('bucket', '=', key)
          .forUpdate()
          .executeTakeFirstOrThrow();
        // Read after the lock: a take that waited for another must not write an older instant over it.
        const at = ctx.clock.now();
        const elapsed =
          Math.max(0, at.epochMilliseconds - decodeInstant(row.refilled_at).epochMilliseconds) /
          1000;
        const available = Math.min(capacity, Number(row.tokens) + elapsed * refillPerSecond);
        const granted = available >= cost;
        await db
          .updateTable(table)
          .set({
            tokens: granted ? available - cost : available,
            refilled_at: encodeInstant(at),
          })
          .where('bucket', '=', key)
          .execute();
        return granted
          ? { ok: true }
          : { ok: false, retryAfter: (cost - available) / refillPerSecond };
      });
    },
  };
}
