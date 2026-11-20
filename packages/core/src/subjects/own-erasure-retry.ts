import type { JobRetry } from '../jobs/job-retry.ts';

/**
 * How the job of an `eraseOwnSubject` request is retried (section 14.7.5): without a count limit,
 * one try an hour at most, for a year. The request waits that long for a rule that holds erasures
 * to lift, or for the rows that hold the subject to go.
 */
export const ownErasureRetry: JobRetry = {
  delays: 'exponential',
  maxDelay: '1h',
  giveUpAfter: '365d',
};
