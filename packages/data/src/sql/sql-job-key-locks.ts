import { sqlJobKeyLock } from './sql-job-key-lock.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** Takes the locks of several keys in one order (by lane, then key), so two units cannot wait on each other. */
export async function sqlJobKeyLocks(
  ctx: SqlUnitContext,
  keys: readonly SqlJobKeyRef[],
): Promise<void> {
  const ordered = [...new Map(keys.map((ref) => [`${ref.laneId}\u0000${ref.key}`, ref])).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, ref]) => ref);
  for (const ref of ordered) await sqlJobKeyLock(ctx, ref.laneId, ref.key);
}

/** A FIFO key of one lane: what the key's advisory lock is taken on. */
export interface SqlJobKeyRef {
  readonly laneId: string;
  readonly key: string;
}
