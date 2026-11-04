import type { JobAttempt, JobStore } from '@keelwerk/core';
import { memoryAdjustLane } from './memory-adjust-lane.ts';
import { memoryJobComplete } from './memory-job-complete.ts';
import { memoryJobEnqueue } from './memory-job-enqueue.ts';
import { memoryJobFinish } from './memory-job-finish.ts';
import { memoryJobScopes } from './memory-job-scopes.ts';
import { memoryJobStats } from './memory-job-stats.ts';
import { memoryJobTake } from './memory-job-take.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * The job store of a unit (14.3.9) over the queue tables as maps: enqueue with the lane upsert
 * and the key policies, cancel, promotion of due `scheduled` jobs, the single-writer fair take,
 * heartbeats, completion and statistics. `schedules()` arrives in M2 with the schedule store (S-03).
 */
export function memoryJobStore(ctx: MemoryUnitContext): JobStore {
  return {
    enqueue: async (job) => memoryJobEnqueue(ctx, job),
    cancel: async (queue, key) => {
      ctx.writable();
      let cancelled = 0;
      for (const tables of memoryJobScopes(ctx)) {
        for (const job of tables.jobs().values()) {
          const pending =
            job.state === 'scheduled' || job.state === 'available' || job.state === 'waiting';
          if (pending && job.spec.queue === queue && job.spec.key?.value === key) {
            memoryJobFinish(ctx, tables, job, 'cancelled', null);
            cancelled += 1;
          }
        }
      }
      return cancelled;
    },
    promote: async (queue, limit) => {
      ctx.writable();
      const now = ctx.clock.now();
      const due = memoryJobScopes(ctx)
        .flatMap((tables) =>
          [...tables.jobs().values()]
            .filter(
              (job) =>
                job.state === 'scheduled' &&
                job.spec.queue === queue &&
                Temporal.Instant.compare(job.runAt, now) <= 0,
            )
            .map((job) => ({ tables, job })),
        )
        .sort((a, b) => Temporal.Instant.compare(a.job.runAt, b.job.runAt) || a.job.id - b.job.id)
        .slice(0, limit);
      for (const { tables, job } of due) {
        tables.putJob({ ...job, state: 'available' });
        memoryAdjustLane(tables, job.laneKey, (lane) => ({ ...lane, enqueued: lane.enqueued + 1 }));
      }
      return due.length;
    },
    take: async (queue, worker, request) => memoryJobTake(ctx, queue, worker, request),
    heartbeat: async (attempts: readonly JobAttempt[], worker, leaseMs) => {
      ctx.writable();
      const leaseUntil = ctx.clock.now().add({ milliseconds: leaseMs });
      const held: JobAttempt[] = [];
      for (const attempt of attempts) {
        for (const tables of memoryJobScopes(ctx)) {
          const job = tables.jobs().get(attempt.jobId);
          if (job === undefined) continue;
          if (job.state === 'running' && job.worker === worker && job.attempt === attempt.attempt) {
            tables.putJob({ ...job, leaseUntil });
            held.push(attempt);
          }
          break;
        }
      }
      return held;
    },
    complete: async (attempt, worker, outcome) => memoryJobComplete(ctx, attempt, worker, outcome),
    stats: async (queue) => memoryJobStats(ctx, queue),
  };
}
