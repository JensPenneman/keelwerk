import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import type { LoadRun } from './load-run.ts';

/**
 * Runs `workers` loops for warm-up plus duration. Closed loop when `ratePerWorker` is undefined (each
 * worker starts its next step when the last ends); otherwise each worker is paced at that many steps
 * per second and latency counts from the scheduled start, so queueing behind a slow step is measured.
 */
export async function runLoad<Sample>(options: {
  readonly workers: number;
  readonly warmupMs: number;
  readonly durationMs: number;
  readonly ratePerWorker?: number | undefined;
  readonly step: (worker: number, iteration: number) => Promise<Sample>;
}): Promise<LoadRun<Sample>> {
  const started = performance.now();
  const windowStart = started + options.warmupMs;
  const windowEnd = windowStart + options.durationMs;
  const latencies: number[] = [];
  const samples: Sample[] = [];
  const workers: number[] = [];
  const rate = options.ratePerWorker;
  const worker = async (index: number): Promise<void> => {
    const interval = rate === undefined ? 0 : 1000 / rate;
    let scheduled = started + (interval * index) / options.workers;
    for (let iteration = 0; ; iteration += 1) {
      const now = performance.now();
      if (now >= windowEnd) return;
      if (rate !== undefined && scheduled > now) await delay(scheduled - now);
      const from = rate === undefined ? performance.now() : scheduled;
      const sample = await options.step(index, iteration);
      if (from >= windowStart && from < windowEnd) {
        latencies.push(performance.now() - from);
        samples.push(sample);
        workers.push(index);
      }
      scheduled += interval;
    }
  };
  await Promise.all(Array.from({ length: options.workers }, (_, index) => worker(index)));
  return { windowMs: options.durationMs, latencies, workers, samples };
}
