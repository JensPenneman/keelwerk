import type { RetentionRun, RetentionRunStore } from '@keelwerk/core';
import { malformedQuery } from '../sql/malformed-query.ts';
import { memoryM2Collections } from './memory-m2-collections.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

const greatestLimit = 1000;

/** `kw_retention_runs` of the in-memory adapter (14.7.1); only deployment-scope units have this store. */
export function memoryRetentionRunStore(ctx: MemoryUnitContext): RetentionRunStore {
  const collection = memoryM2Collections.retentionRuns;
  return {
    append: async (run) => {
      ctx.writable();
      ctx.tx.write<RetentionRun>(collection).set(run.runId, run);
    },
    list: async (query) => {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > greatestLimit) {
        throw malformedQuery(`the limit of a list is a whole number from 1 to ${greatestLimit}`);
      }
      return [...ctx.tx.read<RetentionRun>(collection).values()]
        .filter((run) => run.backendId === query.backendId && run.tenantId === query.tenantId)
        .sort(
          (a, b) =>
            Temporal.Instant.compare(b.startedAt, a.startedAt) ||
            (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0),
        )
        .slice(0, query.limit);
    },
  };
}
