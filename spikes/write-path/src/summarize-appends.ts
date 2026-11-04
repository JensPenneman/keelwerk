import type { LoadRun } from './load-run.ts';
import type { ResultRow } from './result-row.ts';
import type { StepSample } from './step-sample.ts';
import { summarize } from './summarize.ts';

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

/** The writer columns of a results row: committed units per second, latency, tail and retries. */
export function summarizeAppends(run: LoadRun<StepSample>): ResultRow {
  const committed = run.samples.filter((sample) => sample.ok);
  const latency = summarize(run.latencies);
  const retries = run.samples.reduce((total, sample) => total + sample.retries, 0);
  const tailWait = summarize(committed.map((sample) => sample.tailWaitMs));
  const tailHold = summarize(committed.map((sample) => sample.tailHoldMs));
  return {
    'commits/s': Math.round((committed.length * 1000) / run.windowMs),
    'p50 ms': round(latency.p50),
    'p95 ms': round(latency.p95),
    'p99 ms': round(latency.p99),
    'tail wait p95 ms': round(tailWait.p95),
    'tail hold p50 ms': round(tailHold.p50),
    'retries/100 commits':
      committed.length === 0 ? 0 : round((retries * 100) / committed.length, 1),
    'failed/100 units':
      run.samples.length === 0
        ? 0
        : round(((run.samples.length - committed.length) * 100) / run.samples.length, 1),
  };
}
