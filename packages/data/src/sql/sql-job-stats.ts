import type { WorkClassStats } from '@keelwerk/core';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { jobStatsStatement } from './postgres/job-stats-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** Statistics per queue and capability set from the lane tables (21.4); the SLO is configuration, so 0. */
export async function sqlJobStats(
  ctx: SqlUnitContext,
  queue: string | undefined,
): Promise<readonly WorkClassStats[]> {
  const rows = await runSql(
    ctx.db,
    jobStatsStatement(
      ctx.namespace.root,
      queue ?? null,
      encodeInstant(ctx.clock.now()),
      jobUnitScopeId(ctx),
    ),
  );
  return rows.map((row) => ({
    queue: String(row.queue),
    capabilities: row.capability_set === '' ? [] : String(row.capability_set).split(','),
    due: Number(row.due),
    oldestDueSeconds: Number(row.oldest),
    arrivalsPerSecond: Number(row.arrivals) / 60,
    meanRunSeconds: Number(row.mean_run),
    running: Number(row.running),
    queued: Number(row.queued),
    nextDueAt: row.next_due === null ? null : decodeInstant(row.next_due),
    sloSeconds: 0,
  }));
}
