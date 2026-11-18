import { memoryJobScopes } from './memory-job-scopes.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * `JobStore.keyed` over the queue tables as maps: whether a scheduled, available, waiting or
 * running job of `queue` with `key` exists in the scopes the unit reaches.
 */
export function memoryJobKeyed(ctx: MemoryUnitContext, queue: string, key: string): boolean {
  for (const tables of memoryJobScopes(ctx)) {
    for (const job of tables.jobs().values()) {
      if (job.spec.queue === queue && job.spec.key?.value === key && job.state !== 'dead') {
        return true;
      }
    }
  }
  return false;
}
