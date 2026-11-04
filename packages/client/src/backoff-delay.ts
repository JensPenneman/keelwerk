import type { RetryPolicy } from './retry-policy.ts';

/** Full jitter: a random delay up to the exponential bound of the retry (0 is the first retry). */
export function backoffDelay(policy: RetryPolicy, retry: number): number {
  const bound = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** retry);
  return Math.floor(policy.random() * bound);
}
