/** The iterations that started inside the measured window, after the warm-up. */
export interface LoadRun<Sample> {
  readonly windowMs: number;
  /** Per iteration: from its scheduled start (paced runs) or its actual start (closed loop) to its end. */
  readonly latencies: readonly number[];
  /** The worker index of each latency and sample. */
  readonly workers: readonly number[];
  readonly samples: readonly Sample[];
}
