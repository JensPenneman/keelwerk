import type { PurgeBatch } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { checkPurgeLimit } from '../sql/check-purge-limit.ts';
import type { MemoryHistory } from './memory-history.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * `JobStore.purgeHistory` over the scope's history rows: deletes those finished before `before`,
 * lowest job id first, at most `limit`; answers how many it deleted and whether one is left. The jobs
 * table is not touched.
 */
export function memoryJobPurgeHistory(
  ctx: MemoryUnitContext,
  before: Temporal.Instant,
  limit: number,
): PurgeBatch {
  ctx.writable();
  checkPurgeLimit(limit);
  if (ctx.scope.level === 'namespace') {
    throw errors.internal('a namespace-scope unit has no job history to purge');
  }
  const name = `history/${ctx.scopeId()}`;
  const candidates = [...ctx.tx.read<MemoryHistory>(name).values()]
    .filter((row) => Temporal.Instant.compare(row.finishedAt, before) < 0)
    .map((row) => row.jobId)
    .sort((a, b) => Number(BigInt(a) - BigInt(b)));
  const doomed = candidates.slice(0, limit);
  if (doomed.length === 0) return { removed: 0, more: false };
  const table = ctx.tx.write<MemoryHistory>(name);
  for (const jobId of doomed) table.delete(jobId);
  return { removed: doomed.length, more: candidates.length > doomed.length };
}
