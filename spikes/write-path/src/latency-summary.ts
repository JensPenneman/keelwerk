/** Milliseconds, nearest-rank percentiles. */
export interface LatencySummary {
  readonly count: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}
