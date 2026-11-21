import type { SqlJobKeyRef } from './sql-job-key-locks.ts';
import { sqlJobKeyLocks } from './sql-job-key-locks.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * Takes FIFO jobs out only in keys whose advisory locks the unit holds. `readKeys` answers the keys
 * of the jobs that match; `remove` takes out the matching jobs of the locked keys it is given (and
 * any job that is not a FIFO job). The keys are locked in one order, the removal runs, and the keys
 * are read again: a key that appeared between a read and a removal is locked and removed in the
 * next round, until a read shows none that is not locked. A job under a key whose lock the unit did
 * not hold is therefore never taken out, and an append that is open behind it is waited for.
 */
export async function sqlJobDeleteUnderKeyLocks<T>(
  ctx: SqlUnitContext,
  readKeys: () => Promise<readonly SqlJobKeyRef[]>,
  remove: (locked: readonly SqlJobKeyRef[]) => Promise<readonly T[]>,
): Promise<readonly T[]> {
  const locked = new Map<string, SqlJobKeyRef>();
  const removed: T[] = [];
  let first = true;
  while (true) {
    const fresh = (await readKeys()).filter((ref) => !locked.has(`${ref.laneId}\u0000${ref.key}`));
    if (fresh.length === 0 && !first) return removed;
    first = false;
    await sqlJobKeyLocks(ctx, fresh);
    for (const ref of fresh) locked.set(`${ref.laneId}\u0000${ref.key}`, ref);
    removed.push(...(await remove([...locked.values()])));
  }
}
