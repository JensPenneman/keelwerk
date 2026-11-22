import type { BucketTake } from '@keelwerk/core';

/**
 * How far a bucket row's time may lie ahead of the clock that reads it and still count as clock
 * skew between processes; further ahead is taken as a clock jump.
 */
const mostAheadMs = 5000;

/**
 * The tokens a bucket holds as of `at`, and what a take or a check of `cost` answers (S-36). A row
 * dated at or before `at` is credited the elapsed time and dated at `at`. A row dated ahead of `at`
 * credits nothing: up to five seconds ahead it keeps its time, so skew between processes is never
 * credited twice and a refusal adds the seconds the row is ahead to its `retryAfter`; further
 * ahead it is a clock jump and is dated at `at`.
 */
export function bucketLevel(
  row: { readonly tokens: number; readonly refilledAt: Temporal.Instant } | undefined,
  at: Temporal.Instant,
  cost: number,
  limits: { readonly capacity: number; readonly refillPerSecond: number },
): {
  readonly available: number;
  readonly refilledAt: Temporal.Instant;
  readonly answer: BucketTake;
} {
  const { capacity, refillPerSecond } = limits;
  const aheadMs = row === undefined ? 0 : row.refilledAt.epochMilliseconds - at.epochMilliseconds;
  const keptAhead = row !== undefined && aheadMs > 0 && aheadMs <= mostAheadMs;
  let available = capacity;
  if (row !== undefined) {
    const elapsed = aheadMs <= 0 ? -aheadMs / 1000 : 0;
    available = Math.min(capacity, row.tokens + elapsed * refillPerSecond);
  }
  const refilledAt = keptAhead && row !== undefined ? row.refilledAt : at;
  const answer: BucketTake =
    available >= cost
      ? { ok: true }
      : {
          ok: false,
          retryAfter: (cost - available) / refillPerSecond + (keptAhead ? aheadMs / 1000 : 0),
        };
  return { available, refilledAt, answer };
}
