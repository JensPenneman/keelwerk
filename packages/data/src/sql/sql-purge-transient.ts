import type { PurgeBatch } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { checkPurgeLimit } from './check-purge-limit.ts';
import { checkPurgeTypes } from './check-purge-types.ts';
import { encodeInstant } from './encode-instant.ts';
import { purgeTransientStatement } from './postgres/purge-transient-statement.ts';
import { runSql } from './run-sql.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** `EventStore.purgeTransient` over `kw_events`: one call of `kw_purge_transient` in the unit, for the listed stream types only, answering the rows it deleted and whether a candidate is left. */
export async function sqlPurgeTransient(
  ctx: SqlUnitContext,
  before: Temporal.Instant,
  limit: number,
  streamTypes: readonly string[],
): Promise<PurgeBatch> {
  ctx.writable();
  checkPurgeLimit(limit);
  checkPurgeTypes(streamTypes);
  if (ctx.scope.level === 'namespace') {
    throw errors.internal('a namespace-scope unit has no event log');
  }
  const answer = await sqlGuard(() =>
    runSql(
      ctx.db,
      purgeTransientStatement(ctx.namespace.root, {
        before: encodeInstant(before),
        limit,
        streamTypes,
      }),
    ),
  );
  const row = answer[0];
  return { removed: Number(row?.removed ?? 0), more: row?.more === true };
}
