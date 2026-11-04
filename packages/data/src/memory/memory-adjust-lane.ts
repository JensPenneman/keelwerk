import { errors } from '@keelwerk/core';
import type { MemoryJobTables } from './memory-job-tables.ts';
import type { MemoryLane } from './memory-lane.ts';

/** Replaces a lane with the result of `change`; a lane a job names always exists. */
export function memoryAdjustLane(
  tables: MemoryJobTables,
  laneKey: string,
  change: (lane: MemoryLane) => MemoryLane,
): MemoryLane {
  const lane = tables.lanes().get(laneKey);
  if (lane === undefined) throw errors.internal(`the queue has no lane ${laneKey}`);
  const next = change(lane);
  tables.putLane(laneKey, next);
  return next;
}
