import { encodeInstant } from './encode-instant.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { promoteStatement } from './postgres/promote-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * Promotion of due `scheduled` jobs to `available` (9.5.2): timers, retries and delayed sends. Each
 * lane's `enqueued` counter moves at the commit tail with the other changes of the unit. Returns
 * how many jobs were promoted.
 */
export async function sqlJobPromote(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  queue: string,
  limit: number,
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
  for (const row of rows) {
    const count = Number(row.n);
    buffer.moveLane(String(row.lane_id), count);
    promoted += count;
  }
  return promoted;
}
