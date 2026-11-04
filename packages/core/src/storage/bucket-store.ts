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
}
