/** One row of `kw_job_lanes` with its two `kw_job_lane_counts`. */
export interface MemoryLane {
  readonly id: number;
  readonly scopeId: string;
  readonly queue: string;
  readonly capabilitySet: string;
  /** 0 high, 1 normal, 2 low. */
  readonly priority: number;
  readonly cap: number;
  readonly weight: number;
  /** Jobs taken, written by takes. */
  readonly taken: number;
  readonly vtime: number;
  /** Jobs made available, written by enqueue tails, promotions and releases. */
  readonly enqueued: number;
  /** Attempts finished, written by completions. */
  readonly done: number;
}
