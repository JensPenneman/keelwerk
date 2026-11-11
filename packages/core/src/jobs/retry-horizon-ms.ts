import { durationMs } from '../effects/duration-ms.ts';
import { defaultJobRetry } from './default-job-retry.ts';
import type { JobRetry } from './job-retry.ts';

/**
 * How long after its creation a job may still be attempted, as far as its retry policy goes: the
 * larger of its `giveUpAfter` and its count limit (3 when absent) times its largest delay (the
 * largest listed delay, or the exponential series' `maxDelay`, which an empty list also uses, 10 minutes by default, and never above
 * `maxDelay`). A job with a `giveUpAfter` and no limit is bounded by time alone. An upper bound: the
 * retry jitter only shortens a delay.
 */
export function retryHorizonMs(retry: JobRetry | undefined): number {
  const cap = durationMs(retry?.maxDelay ?? defaultJobRetry.maxDelay);
  const delays = retry?.delays ?? 'exponential';
  const largest =
    delays === 'exponential' || delays.length === 0
      ? cap
      : Math.min(cap, Math.max(0, ...delays.map(durationMs)));
  const byTime = retry?.giveUpAfter === undefined ? 0 : durationMs(retry.giveUpAfter);
  const byCount =
    retry?.limit === undefined && retry?.giveUpAfter !== undefined
      ? 0
      : (retry?.limit ?? defaultJobRetry.limit) * largest;
  return Math.max(byTime, byCount);
}
