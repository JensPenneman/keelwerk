import type { JobAttempt } from '@keelwerk/core';
import { memoryAdjustLane } from './memory-adjust-lane.ts';
import { memoryJobGroups } from './memory-job-groups.ts';
import { memoryJobScopes } from './memory-job-scopes.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * `JobStore.release` over the queue tables (21.6 step 4): each running attempt of the worker goes
 * back to `available` with its attempt given back, so the next take hands it out under the same
 * number. The lost-lease count stays, the lane's `taken` and the group's running slot are given back.
 * The job is takeable again, so its queue is recorded as readied; for a job in a group `readied`
 * answers `undefined` (cannot name the queue), as for a completion, because a job of another queue
 * may wait for the group's slot.
 */
export function memoryJobReleaseAttempts(
  ctx: MemoryUnitContext,
  attempts: readonly JobAttempt[],
  worker: string,
): readonly JobAttempt[] {
  ctx.writable();
  const groups = memoryJobGroups(ctx);
  const released: JobAttempt[] = [];
  for (const attempt of attempts) {
    for (const tables of memoryJobScopes(ctx)) {
      const job = tables.jobs().get(attempt.jobId);
      if (job === undefined) continue;
      if (job.state === 'running' && job.worker === worker && job.attempt === attempt.attempt) {
        if (job.spec.group === undefined) ctx.readied.ready(job.spec.queue);
        else {
          ctx.readied.readyAnywhere();
          const spans = job.spec.group.scope === 'namespace';
          const group = groups.get(job.scopeId, job.spec.group.id, spans);
          if (group !== undefined) {
            groups.put(job.scopeId, spans, { ...group, running: group.running - 1 });
          }
        }
        memoryAdjustLane(tables, job.laneKey, (lane) => ({ ...lane, taken: lane.taken - 1 }));
        tables.putJob({
          ...job,
          state: 'available',
          attempt: Math.max(job.attempt - 1, 0),
          worker: null,
          leaseUntil: null,
        });
        released.push(attempt);
      }
      break;
    }
  }
  return released;
}
