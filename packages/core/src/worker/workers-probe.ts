/** What a test sees of the workers of a process: a tick on demand and the moment they have nothing left to do. */
export interface WorkersProbe {
  /**
   * Runs a tick (renewals, expiries, a sweep of every fetcher once, in every namespace).
   * A commit's job wake-up sweeps the queues it names (all of them when it names none) in its own
   * namespace; this sweeps every fetcher in every namespace. The sweep comes after the attended runs
   * have settled, so what they enqueue is swept with it.
   */
  wake(): void;
  /**
   * Settles when no fetcher has a wake pending or a sweep running, each one's last sweep took no job
   * and skipped no lane, and no slot runs a job.
   */
  idle(): Promise<void>;
  /** Attempts settled since start (completed in a unit, given up, retried or lost). */
  readonly settled: number;
}
