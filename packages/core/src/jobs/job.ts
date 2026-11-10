import type { StoredJob } from '../storage/stored-job.ts';

/** A taken job as the handler of `JobQueue.work` receives it (S-156); its attempt is `stored.attempt`. */
export interface Job {
  readonly stored: StoredJob;
  /** Aborts at expireInSeconds (core.timeout) or when the lease is lost. */
  readonly signal: AbortSignal;
  /** Asks the worker to renew this attempt's lease now. */
  heartbeat(): void;
}
