import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { keyedJobStatement } from './postgres/keyed-job-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** `JobStore.keyed` on the PostgreSQL dialect: a live job of the queue with the key in the unit's reach. */
export async function sqlJobKeyed(
  ctx: SqlUnitContext,
  queue: string,
  key: string,
): Promise<boolean> {
  const [row] = await runSql(
    ctx.db,
    keyedJobStatement(ctx.namespace.root, queue, key, jobUnitScopeId(ctx)),
  );
  return row !== undefined;
}
