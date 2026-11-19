import type { PurgeBatch } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { checkPurgeLimit } from './check-purge-limit.ts';
import { encodeInstant } from './encode-instant.ts';
import { jobHistoryRemainsStatement } from './postgres/job-history-remains-statement.ts';
import { purgeJobHistoryStatement } from './postgres/purge-job-history-statement.ts';
import { runSql } from './run-sql.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** `JobStore.purgeHistory` over `kw_job_history`: the delete, then a read of what is left (the batch size says nothing about it when another pass deleted rows meanwhile). */
export async function sqlJobPurgeHistory(
  ctx: SqlUnitContext,
  before: Temporal.Instant,
  limit: number,
): Promise<PurgeBatch> {
  ctx.writable();
  checkPurgeLimit(limit);
  if (ctx.scope.level === 'namespace') {
    throw errors.internal('a namespace-scope unit has no job history to purge');
  }
  const scopeId = ctx.scopeId();
  const at = encodeInstant(before);
  const removed = await sqlGuard(() =>
    runSql(ctx.db, purgeJobHistoryStatement(ctx.namespace.root, { scopeId, before: at, limit })),
  );
  const left = await sqlGuard(() =>
    runSql(ctx.db, jobHistoryRemainsStatement(ctx.namespace.root, { scopeId, before: at })),
  );
  return { removed: removed.length, more: left[0]?.more === true };
}
