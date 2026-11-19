/** One resolved limit; bytes and counts as whole numbers, a rate as a token bucket. */
export type QuotaLimit =
  | { readonly kind: 'bytes' | 'count'; readonly value: number }
  | { readonly kind: 'rate'; readonly capacity: number; readonly refillPerSecond: number };
