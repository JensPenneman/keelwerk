import { memoryJobIsQueued } from './memory-job-is-queued.ts';
import type { MemoryJobTables } from './memory-job-tables.ts';

/**
 * The jobs of `queue` that wait to run in the queue tables of `scopes`, counted up to `limit + 1`
 * and no further. The one counting loop of the memory adapter: `JobStore.queued` and the queued cap
 * of the commit tail count through it.
 */
export function memoryQueuedCount(
  scopes: readonly MemoryJobTables[],
  queue: string,
  limit: number,
): number {
  let counted = 0;
  for (const tables of scopes) {
    for (const job of tables.jobs().values()) {
      if (job.spec.queue === queue && memoryJobIsQueued(job)) {
        counted += 1;
        if (counted > limit) return counted;
      }
    }
  }
  return counted;
}
