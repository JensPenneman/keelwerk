import { jobKeyLockSql } from './job-key-lock-sql.ts';
import { runSql } from './run-sql.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * Takes the transaction-scoped advisory lock of a lane and key (9.5.2), held to the end of the unit;
 * taking it again in the same unit is free. It serialises the unit that appends a job under the key
 * with the units that end the key's head: an append sees the head as it is after an ending unit
 * committed, or the ending unit waits for the append's commit and then releases the appended job.
 * Every unit that waits for the lock takes it before its rows: a purge and a cancel by key before
 * they delete rows, a completion before it changes the running head's row, an enqueue before it
 * reads the key's pending rows. A take locks its rows first and tries the key last
 * (`reclaimAttemptStatement`), which is safe because a try never waits: the reclaim of a dying FIFO
 * head leaves the keys whose lock another unit holds to a later take, so no take waits behind an open
 * unit and none is part of a deadlock. Units that take two key locks in opposite orders (enqueues,
 * cancels by key, erasures) can still deadlock with each other.
 */
export async function sqlJobKeyLock(
  ctx: SqlUnitContext,
  laneId: string,
  key: string,
): Promise<void> {
  await runSql(ctx.db, {
    sql: `select pg_advisory_xact_lock(${jobKeyLockSql('$1', '$2', '$3')})`,
    parameters: [ctx.namespace.root, laneId, key],
  });
}
