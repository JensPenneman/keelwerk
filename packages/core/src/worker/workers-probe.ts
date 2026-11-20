/** What a test sees of the workers of a process: a tick on demand and the moment they have nothing left to do. */
export interface WorkersProbe {
  /**
   * Runs a tick (renewals, expiries, pending wake-ups, polls due) at once; then, after the attended
   * runs have settled and (on the in-process feeds) one turn of the event loop has delivered the
   * wake-ups already pushed, sweeps each fetcher once in every namespace. A fetcher is left out only
   * when its last sweep of every namespace came to rest at the clock's reading and every source is
   * one process whose feed notifies. What a drain guarantees is said at `TestRuntime.drainJobs` of
   * `@keelwerk/testing`.
   */
  wake(): void;
  /**
   * Settles when no attended run or probe sweep is under way, no lease renewal is under way, no
   * fetcher has a wake pending or a sweep running, and no slot runs a job.
   */
  idle(): Promise<void>;
  /** Attempts settled since start (completed in a unit, given up, retried or lost). */
  readonly settled: number;
}
