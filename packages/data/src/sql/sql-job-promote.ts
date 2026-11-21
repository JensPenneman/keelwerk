import { encodeInstant } from './encode-instant.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { promoteStatement } from './postgres/promote-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * Promotion of due `scheduled` jobs to `available` (9.5.2): timers, retries and delayed sends. The
 * statement counts each promoted job on its lane at once, under the lane's counter row, which it
 * locks without waiting: a due job of a lane whose counter row another unit holds stays `scheduled`
 * for a later promotion, so a take of the same unit sees every job promoted and nothing waits at the
 * commit tail. A lane whose counter row is held is added to `left`, which the take of the unit counts
 * as skipped, so the fetcher takes again. The queue is recorded as takeable. Returns how many jobs
 * were promoted.
 */
export async function sqlJobPromote(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  queue: string,
  limit: number,
  left: Set<string>,
): Promise<number> {
  const rows = await runSql(
    ctx.db,
    promoteStatement({
      root: ctx.namespace.root,
      queue,
      limit,
      now: encodeInstant(ctx.clock.now()),
      scopeId: jobUnitScopeId(ctx),
    }),
  );
  let promoted = 0;
  left.clear();
  for (const row of rows) {
    promoted += Number(row.n);
    if (Number(row.n) === 0) left.add(String(row.lane_id));
  }
  if (promoted > 0) buffer.ready(queue);
  return promoted;
}
