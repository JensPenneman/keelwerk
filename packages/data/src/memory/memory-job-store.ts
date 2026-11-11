import type { JobAttempt, JobGroup, JobStore } from '@keelwerk/core';
import { errors, timerQueue } from '@keelwerk/core';
import { memoryAdjustLane } from './memory-adjust-lane.ts';
import { memoryJobComplete } from './memory-job-complete.ts';
import { memoryJobEnqueue } from './memory-job-enqueue.ts';
import { memoryJobFinish } from './memory-job-finish.ts';
import { memoryJobGroups } from './memory-job-groups.ts';
import { memoryJobScopes } from './memory-job-scopes.ts';
import { memoryJobStats } from './memory-job-stats.ts';
import { memoryJobTake } from './memory-job-take.ts';
import { memoryParseRate } from './memory-parse-rate.ts';
import { memoryReleaseJobGroup } from './memory-release-job-group.ts';
import { memoryScheduleStore } from './memory-schedule-store.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** The job store of a unit with the provisioning of namespace groups, which `JobStore` of core lacks. */
export interface MemoryJobStore extends JobStore {
  provisionGroup(group: JobGroup): Promise<void>;
}

/**
 * The job store of a unit (14.3.9) over the queue tables as maps: enqueue with the lane upsert
 * and the key policies, cancel, promotion of due `scheduled` jobs, the single-writer fair take,
 * heartbeats, completion and statistics, and the schedule table's rows. A cancel by key also takes the
 * running attempt of the key (its worker's completion then answers a lost lease).
 */
export function memoryJobStore(ctx: MemoryUnitContext): MemoryJobStore {
  return {
    provisionGroup: async (group) => {
      ctx.writable();
      if (ctx.scope.level !== 'namespace' || group.scope !== 'namespace') {
        throw errors.internal(
          'a namespace job group is provisioned by a namespace-scope unit only',
        );
      }
      const groups = memoryJobGroups(ctx);
      const before = groups.get('', group.id, true);
      const rate = group.rate === undefined ? null : memoryParseRate(group.rate);
      groups.put('', true, {
        id: group.id,
        concurrency: group.concurrency ?? null,
        running: before?.running ?? 0,
        rate,
        tokens: before?.tokens ?? rate?.count ?? 0,
        refilledAt: before?.refilledAt ?? ctx.clock.now(),
        blockedUntil: before?.blockedUntil ?? null,
      });
    },
    enqueue: async (job) => memoryJobEnqueue(ctx, job),
    cancel: async (queue, key) => {
      ctx.writable();
      let cancelled = 0;
      for (const tables of memoryJobScopes(ctx)) {
        for (const job of tables.jobs().values()) {
          // A running attempt is cancelled only in the timers queue: its row goes, so the completion
          // of its worker matches nothing (a lost lease) and exactly one of the cancel and its
          // command wins. In any other queue the command may commit in another scope's unit, so a
          // running job is left to finish.
          const cancellable =
            job.state === 'scheduled' ||
            job.state === 'available' ||
            job.state === 'waiting' ||
            (job.state === 'running' && queue === timerQueue);
          if (cancellable && job.spec.queue === queue && job.spec.key?.value === key) {
            if (job.state === 'running') memoryReleaseJobGroup(ctx, job);
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
    schedules: () => memoryScheduleStore(ctx),
  };
}
