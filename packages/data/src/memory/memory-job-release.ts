import { memoryAdjustLane } from './memory-adjust-lane.ts';
import type { MemoryJob } from './memory-job.ts';
import type { MemoryJobTables } from './memory-job-tables.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * FIFO per key (9.1.2, 9.5.2): when a job with an ordering key leaves the queue, the key's next
 * `waiting` job becomes available (or scheduled, when its time has not come) and is counted on its lane.
 */
export function memoryJobRelease(
  ctx: MemoryUnitContext,
  tables: MemoryJobTables,
  finished: MemoryJob,
): void {
  const key = finished.spec.key?.value;
  if (finished.spec.ordering !== 'fifo-per-key' || key === undefined) return;
  const next = [...tables.jobs().values()]
    .filter(
      (job) =>
        job.state === 'waiting' && job.laneKey === finished.laneKey && job.spec.key?.value === key,
    )
    .sort((a, b) => a.id - b.id)
    .at(0);
  if (next === undefined) return;
  const due = Temporal.Instant.compare(next.runAt, ctx.clock.now()) <= 0;
  tables.putJob({ ...next, state: due ? 'available' : 'scheduled' });
  if (due)
    memoryAdjustLane(tables, next.laneKey, (lane) => ({ ...lane, enqueued: lane.enqueued + 1 }));
}
