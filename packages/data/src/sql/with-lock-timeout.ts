import { sql } from 'kysely';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * Runs `work` with the unit's `lock_timeout` set to `ms`, so a row lock another unit holds is waited
 * for only briefly, and puts the unit's own setting back afterwards (S-173). The setting is local to
 * the transaction. When `work` fails the transaction, or the savepoint around it, is rolled back and
 * with it the setting, so the setting is restored on success only. A statement that times out fails
 * with SQLSTATE 55P03 (`isLockUnavailable`), which the caller answers.
 */
export async function withLockTimeout<T>(
  ctx: Pick<SqlUnitContext, 'db'>,
  ms: number,
  work: () => Promise<T>,
): Promise<T> {
  const { db } = ctx;
  const before = await sqlGuard(async () =>
    sql<{ value: string }>`select current_setting('lock_timeout') as value`.execute(db),
  );
  const previous = before.rows[0]?.value ?? '0';
  await sqlGuard(async () =>
    sql`select set_config('lock_timeout', ${`${ms}ms`}, true)`.execute(db),
  );
  const value = await work();
  await sqlGuard(async () => sql`select set_config('lock_timeout', ${previous}, true)`.execute(db));
  return value;
}
