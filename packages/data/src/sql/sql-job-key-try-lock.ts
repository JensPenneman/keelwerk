import { jobKeyLockText } from './job-key-lock-text.ts';
import { runSql } from './run-sql.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * Tries the advisory lock of a lane and key (`sqlJobKeyLock`) without waiting: true when the unit
 * holds it afterwards (it took it now or held it already), false when another unit holds it. A lock
 * that was taken stays held to the end of the unit.
 */
export async function sqlJobKeyTryLock(
  ctx: SqlUnitContext,
  laneId: string,
  key: string,
): Promise<boolean> {
  const [row] = await runSql(ctx.db, {
    sql: 'select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as locked',
    parameters: [jobKeyLockText(ctx.namespace.root, laneId, key)],
  });
  return row?.locked === true;
}
