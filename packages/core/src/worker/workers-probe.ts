/** What a test sees of the workers of a process: a tick on demand and the moment they have nothing left to do. */
export interface WorkersProbe {
  /** Runs a tick now (renewals, expiries, a sweep of every fetcher), as a commit wake-up would. */
  wake(): void;
  /**
   * Settles when no fetcher has a wake pending or a sweep running, each one's last sweep took no job
   * and skipped no lane, and no slot runs a job.
   */
  idle(): Promise<void>;
  /** Attempts settled since start (completed in a unit, given up, retried or lost). */
  readonly settled: number;
}
