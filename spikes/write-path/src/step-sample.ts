/** What one iteration of a load worker reports beyond its latency, which the runner measures. */
export interface StepSample {
  readonly ok: boolean;
  readonly retries: number;
  readonly tailWaitMs: number;
  readonly tailHoldMs: number;
  readonly loadMs: readonly number[];
  readonly stale: boolean;
}
