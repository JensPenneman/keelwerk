import type { JobStore } from '../storage/job-store.ts';
import type { QueueSource } from './queue-source.ts';

/**
 * One take of a fetcher on one namespace (9.5.6): due `scheduled` jobs (timers, retries) are promoted
 * first, up to 100, then the fair take of 9.5.3 runs, both in one namespace-scope unit. The take
 * reclaims expired leases itself.
 */
export function takeBatch(
  source: QueueSource,
  queue: string,
  worker: string,
  request: Parameters<JobStore['take']>[2],
): Promise<Awaited<ReturnType<JobStore['take']>>> {
  return source.handle.adapter.unit(
    source.namespace,
    { level: 'namespace', reason: 'jobs' },
    async (unit) => {
      await unit.jobs.promote(queue, 100);
      return unit.jobs.take(queue, worker, request);
    },
  );
}
