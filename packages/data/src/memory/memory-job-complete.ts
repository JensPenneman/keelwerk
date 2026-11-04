import type { JobAttempt, JobOutcome } from '@keelwerk/core';
import { memoryAdjustLane } from './memory-adjust-lane.ts';
import { memoryJobFinish } from './memory-job-finish.ts';
import { memoryJobGroups } from './memory-job-groups.ts';
import { memoryJobScopes } from './memory-job-scopes.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * Completion, conditional on (worker, attempt) (9.5.4): success removes the job and writes
 * history, a retryable failure schedules the next attempt (and blocks the job's group until a
 * `rate_limited` error's `retryAfter`), a dead letter keeps the input, a failure without a
 * target writes history only. The key's next FIFO job is released. `false` when the lease was
 * lost: the job is not running for this worker and attempt any more.
 */
export function memoryJobComplete(
  ctx: MemoryUnitContext,
  attempt: JobAttempt,
  worker: string,
  outcome: JobOutcome,
): boolean {
  ctx.writable();
  const now = ctx.clock.now();
  for (const tables of memoryJobScopes(ctx)) {
    const job = tables.jobs().get(attempt.jobId);
    if (job === undefined) continue;
    if (job.state !== 'running' || job.worker !== worker || job.attempt !== attempt.attempt) {
      return false;
    }
    const groups = memoryJobGroups(ctx);
    const spans = job.spec.group?.scope === 'namespace';
    const group =
      job.spec.group === undefined ? undefined : groups.get(job.scopeId, job.spec.group.id, spans);
    if (group !== undefined) {
      const retryAfter =
        outcome.kind === 'retry' && outcome.error.kind === 'rate_limited'
          ? outcome.error.retryAfter
          : undefined;
      groups.put(job.scopeId, spans, {
        ...group,
        running: group.running - 1,
        blockedUntil:
          retryAfter === undefined
            ? group.blockedUntil
            : now.add({ milliseconds: Math.ceil(retryAfter * 1000) }),
      });
    }
    switch (outcome.kind) {
      case 'succeeded':
        memoryJobFinish(ctx, tables, job, 'succeeded', null);
        break;
      case 'failed':
        memoryJobFinish(ctx, tables, job, 'failed', outcome.error);
        break;
      case 'dead':
        memoryJobFinish(ctx, tables, job, 'dead', outcome.error);
        break;
      case 'retry':
        tables.putJob({
          ...job,
          state: 'scheduled',
          runAt: outcome.at,
          worker: null,
          leaseUntil: null,
          lostLeases: 0,
        });
        memoryAdjustLane(tables, job.laneKey, (lane) => ({ ...lane, done: lane.done + 1 }));
        break;
    }
    return true;
  }
  return false;
}
