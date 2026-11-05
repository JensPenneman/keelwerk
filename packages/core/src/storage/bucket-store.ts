import type { BucketTake } from './bucket-take.ts';

/** Shared token buckets under forced row-level security (S-36). */
export interface BucketStore {
  /**
   * Takes `cost` tokens from one bucket, creating it full at `capacity`. The key is the HMAC of the
   * bucket key, never the plain identifier or address.
   */
  take(
    bucket: string,
    cost: number,
    limits: { readonly capacity: number; readonly refillPerSecond: number },
  ): Promise<BucketTake>;
  /**
   * Reads whether `take(bucket, cost, limits)` would succeed now, without taking: the same refill
   * arithmetic as `take`, no row created or written, no lock held. A bucket never seen counts as
   * full. A refusal reports the seconds until `cost` tokens have refilled.
   */
  check(
    bucket: string,
    cost: number,
    limits: { readonly capacity: number; readonly refillPerSecond: number },
  ): Promise<BucketTake>;
}
