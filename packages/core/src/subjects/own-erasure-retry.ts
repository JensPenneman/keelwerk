import type { JobRetry } from '../jobs/job-retry.ts';

/**
 * How the job of an `eraseOwnSubject` request is retried (section 14.7.5): without an end, with
 * gaps that grow from a second to at most an hour, each drawn at random up to the gap
 * (`retryDelay`). The request waits for as long as a rule that holds erasures, a flag that cannot be
 * read or the rows that hold the subject keep it back.
 */
export const ownErasureRetry: JobRetry = {
  delays: 'exponential',
  maxDelay: '1h',
  limit: Number.MAX_SAFE_INTEGER,
};
