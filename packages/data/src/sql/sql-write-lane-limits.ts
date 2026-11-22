import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import type { SqlLaneLimit } from './sql-lane-limit.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * Writes the cap and weight a unit gave its existing lanes: one `update` for each lane, the last
 * value the unit gave it, in ascending lane id, so that two units that change the same lanes
 * take the lanes' row locks in one order and never wait for each other in a cycle (9.5.2). It runs
 * after the unit's own work and before the commit tail, which also takes row locks in ascending
 * order of the lane id. The update takes the row's lock (no key update) until the unit ends:
 * a unit's end step that changes the same lane, or a drain's settle of it, waits for it, and a take
 * skips the lane meanwhile.
 */
export async function sqlWriteLaneLimits(
  ctx: SqlUnitContext,
  limits: readonly SqlLaneLimit[],
): Promise<void> {
  if (limits.length === 0) return;
  const root = quoteIdentifier(ctx.namespace.root);
  const scopeId = ctx.scopeId();
  const last = new Map<string, SqlLaneLimit>();
  for (const limit of limits) last.set(limit.laneId, limit);
  const ordered = [...last.values()].sort((a, b) => {
    const left = BigInt(a.laneId);
    const right = BigInt(b.laneId);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const { laneId, cap, weight } of ordered) {
    await runSql(ctx.db, {
      sql: `update ${root}.kw_job_lanes set cap = $2::integer, weight = $4::integer where id = $1::bigint and scope_id = $3::uuid`,
      parameters: [laneId, String(cap), scopeId, String(weight)],
    });
  }
}
