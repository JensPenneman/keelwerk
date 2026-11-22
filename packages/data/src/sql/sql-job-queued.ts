import { checkQueuedLimit } from './check-queued-limit.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { queuedJobsStatement } from './postgres/queued-jobs-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * `JobStore.queued` on the PostgreSQL dialect: the queued jobs (section 9.5.5) of `queue` in the
 * unit's reach, counted up to `limit + 1`.
 */
export async function sqlJobQueued(
  ctx: SqlUnitContext,
  queue: string,
  limit: number,
): Promise<number> {
  checkQueuedLimit(limit);
  const [row] = await runSql(
    ctx.db,
    queuedJobsStatement(ctx.namespace.root, queue, jobUnitScopeId(ctx), limit + 1),
  );
  return Number(row?.queued ?? 0);
}
