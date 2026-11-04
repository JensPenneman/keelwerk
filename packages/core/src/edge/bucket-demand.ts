/** One token bucket an admission rule charges (section 12.2). */
export interface BucketCharge {
  readonly bucket: string;
  readonly cost?: number;
  readonly capacity: number;
  readonly refillPerSecond: number;
}

/** What an admission rule returns: the buckets it charges. */
export interface BucketDemand {
  /** Charged at `admit`; an empty bucket refuses with `rate_limited`. */
  readonly admit: readonly BucketCharge[];
  /** Charged only when the invocation fails with a declared error. */
  readonly onDeclaredError: readonly BucketCharge[];
}
