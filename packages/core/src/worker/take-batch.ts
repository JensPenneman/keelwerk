import type { JobStore } from '../storage/job-store.ts';
import type { QueueSource } from './queue-source.ts';

/** What one take answers: the fair take's answer and how many due jobs the promotion before it moved. */
export type TakenBatch = Awaited<ReturnType<JobStore['take']>> & { readonly promoted: number };

/**
 * One take of a fetcher on one namespace (9.5.6): due `scheduled` jobs (timers, retries) are promoted
 * first, up to 100, then the fair take of 9.5.3 runs, both in one namespace-scope unit. The take
 * reclaims expired leases itself. A store counts a promoted job on its lane when the unit commits, so
 * the take of the same unit may not see it: `promoted` tells the fetcher to take again.
 */
export function takeBatch(
  source: QueueSource,
  queue: string,
  worker: string,
  request: Parameters<JobStore['take']>[2],
): Promise<TakenBatch> {
  return source.handle.adapter.unit(
    source.namespace,
    { level: 'namespace', reason: 'jobs' },
    async (unit) => {
      const promoted = await unit.jobs.promote(queue, 100);
      return { ...(await unit.jobs.take(queue, worker, request)), promoted };
    },
  );
}
