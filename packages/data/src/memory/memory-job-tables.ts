import type { MemoryHistory } from './memory-history.ts';
import type { MemoryJob } from './memory-job.ts';
import type { MemoryLane } from './memory-lane.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** One scope's queue tables as a unit sees them; every mutator checks that the unit may write. */
export interface MemoryJobTables {
  readonly scopeId: string;
  lanes(): ReadonlyMap<string, MemoryLane>;
  jobs(): ReadonlyMap<string, MemoryJob>;
  history(): ReadonlyMap<string, MemoryHistory>;
  putLane(key: string, lane: MemoryLane): void;
  putJob(job: MemoryJob): void;
  deleteJob(id: number): void;
  putHistory(row: MemoryHistory): void;
}

/** The tables of one scope's queue; the groups are namespace-wide and reached through `memoryJobGroups`. */
export function memoryJobTables(ctx: MemoryUnitContext, scopeId: string): MemoryJobTables {
  return {
    scopeId,
    lanes: () => ctx.tx.read<MemoryLane>(`lanes/${scopeId}`),
    jobs: () => ctx.tx.read<MemoryJob>(`jobs/${scopeId}`),
    history: () => ctx.tx.read<MemoryHistory>(`history/${scopeId}`),
    putLane: (key, lane) => {
      ctx.writable();
      ctx.tx.write<MemoryLane>(`lanes/${scopeId}`).set(key, lane);
    },
    putJob: (job) => {
      ctx.writable();
      ctx.tx.write<MemoryJob>(`jobs/${scopeId}`).set(String(job.id), job);
    },
    deleteJob: (id) => {
      ctx.writable();
      ctx.tx.write<MemoryJob>(`jobs/${scopeId}`).delete(String(id));
    },
    putHistory: (row) => {
      ctx.writable();
      ctx.tx.write<MemoryHistory>(`history/${scopeId}`).set(row.jobId, row);
    },
  };
}
