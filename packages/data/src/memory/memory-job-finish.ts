import type { WireError } from '@keelwerk/core';
import { memoryAdjustLane } from './memory-adjust-lane.ts';
import type { MemoryHistory } from './memory-history.ts';
import type { MemoryJob } from './memory-job.ts';
import { memoryJobRelease } from './memory-job-release.ts';
import type { MemoryJobTables } from './memory-job-tables.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * Takes a job out of the queue (or makes it a dead letter) and writes its history row, which never
 * holds the input. A running attempt that ends counts on its lane's `done`; a job that never ran
 * leaves `enqueued` when it was available. The key's next FIFO job is released.
 */
export function memoryJobFinish(
  ctx: MemoryUnitContext,
  tables: MemoryJobTables,
  job: MemoryJob,
  outcome: MemoryHistory['outcome'],
  error: WireError | null,
): void {
  const wasRunning = job.state === 'running';
  if (outcome === 'dead') tables.putJob({ ...job, state: 'dead', worker: null, leaseUntil: null });
  else tables.deleteJob(job.id);
  if (wasRunning) {
    memoryAdjustLane(tables, job.laneKey, (lane) => ({ ...lane, done: lane.done + 1 }));
  } else if (job.state === 'available') {
    memoryAdjustLane(tables, job.laneKey, (lane) => ({ ...lane, enqueued: lane.enqueued - 1 }));
  }
  tables.putHistory({
    scopeId: tables.scopeId,
    jobId: String(job.id),
    queue: job.spec.queue,
    kind: job.spec.kind,
    outcome,
    attempts: job.attempt,
    startedAt: job.startedAt,
    finishedAt: ctx.clock.now(),
    error,
  });
  if (outcome !== 'cancelled') memoryJobRelease(ctx, tables, job);
}
