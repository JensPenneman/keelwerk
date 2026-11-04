import type { LatencySummary } from './latency-summary.ts';

const rank = (sorted: Float64Array, fraction: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ??
  Number.NaN;

/** Summarises latencies with nearest-rank percentiles; an empty input gives NaN everywhere but the count. */
export function summarize(values: readonly number[]): LatencySummary {
  const sorted = Float64Array.from(values).sort();
  let total = 0;
  for (const value of sorted) total += value;
  return {
    count: sorted.length,
    mean: sorted.length === 0 ? Number.NaN : total / sorted.length,
    p50: rank(sorted, 0.5),
    p95: rank(sorted, 0.95),
    p99: rank(sorted, 0.99),
    max: sorted.length === 0 ? Number.NaN : (sorted[sorted.length - 1] ?? Number.NaN),
  };
}
