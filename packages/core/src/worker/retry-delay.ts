import { durationMs } from '../effects/duration-ms.ts';
import type { JobRetry } from '../jobs/job-retry.ts';

/** The attempts a job without a count limit may use: three, as long as no `giveUpAfter` replaces the count. */
const defaultLimit = 3;
const baseDelayMs = 1000;
const defaultMaxDelay = '10m';

/**
 * The milliseconds before the next attempt of a job that failed with a retryable error (9.5.4, D4),
 * or undefined when `attempt` (1-based) used the count limit: `limit` counts attempts, and is 3 when
 * absent, or unbounded when `giveUpAfter` bounds the retries by time instead. A job without a retry
 * policy is attempted three times (two retries) over an exponential series from one second.
 * Exponential delays double from one second up to `maxDelay` (default 10 minutes); explicit delays
 * repeat the last one. Every delay is drawn with full jitter, uniformly between zero and the delay.
 */
export function retryDelay(
  retry: JobRetry | undefined,
  attempt: number,
  random: () => number,
): number | undefined {
  const policy: JobRetry = retry ?? { delays: 'exponential' };
  const limit =
    policy.limit ?? (policy.giveUpAfter === undefined ? defaultLimit : Number.POSITIVE_INFINITY);
  if (attempt >= limit) return undefined;
  const ceiling = durationMs(policy.maxDelay ?? defaultMaxDelay);
  const { delays } = policy;
  const wanted =
    delays === 'exponential'
      ? baseDelayMs * 2 ** Math.min(attempt - 1, 40)
      : durationMs(delays[Math.min(attempt, delays.length) - 1] ?? defaultMaxDelay);
  const delay = Math.min(wanted, ceiling);
  return Math.floor(random() * (delay + 1));
}
