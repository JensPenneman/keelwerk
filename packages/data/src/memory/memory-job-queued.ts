import { checkQueuedLimit } from '../sql/check-queued-limit.ts';
import { memoryJobScopes } from './memory-job-scopes.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * `JobStore.queued` over the queue tables as maps: the scheduled, available and waiting jobs of
 * `queue` in the scopes the unit reaches, counted up to `limit + 1` and no further.
 */
export function memoryJobQueued(ctx: MemoryUnitContext, queue: string, limit: number): number {
  checkQueuedLimit(limit);
  let counted = 0;
  for (const tables of memoryJobScopes(ctx)) {
    for (const job of tables.jobs().values()) {
      if (
        job.spec.queue === queue &&
        (job.state === 'scheduled' || job.state === 'available' || job.state === 'waiting')
      ) {
        counted += 1;
        if (counted > limit) return counted;
      }
    }
  }
  return counted;
}
