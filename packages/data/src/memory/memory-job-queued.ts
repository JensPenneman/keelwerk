import { checkQueuedLimit } from '../sql/check-queued-limit.ts';
import { memoryJobScopes } from './memory-job-scopes.ts';
import { memoryQueuedCount } from './memory-queued-count.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** `JobStore.queued` over the queue tables as maps: the jobs of `queue` that wait to run in the scopes the unit reaches, counted up to `limit + 1`. */
export function memoryJobQueued(ctx: MemoryUnitContext, queue: string, limit: number): number {
  checkQueuedLimit(limit);
  return memoryQueuedCount(memoryJobScopes(ctx), queue, limit);
}
