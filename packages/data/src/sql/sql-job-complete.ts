import type { JobAttempt, JobOutcome } from '@keelwerk/core';
import { encodeInstant } from './encode-instant.ts';
import { groupKeyOfJob } from './group-key-of-job.ts';
import { completeJobStatement } from './postgres/complete-job-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlJobRelease } from './sql-job-release.ts';
import { sqlLaneChanges } from './sql-lane-changes.ts';
import { sqlReleaseGroups } from './sql-release-groups.ts';
import { sqlSettleLanes } from './sql-settle-lanes.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * Completion of an attempt in the job's own unit (9.5.2, 14.3.9), conditional on (worker, attempt):
 * one statement removes the job (success, failure), keeps it as a dead letter or schedules the next
 * attempt, and writes the history row; `false` when the lease was lost. The lane's `done` counter
 * and the group's running slot are given back at the end of the unit, before the commit tail, so
 * the hot counter rows are locked for as short a time as possible. A job that ends (not a retry)
 * releases the next job of its key when the queue orders by key.
 */
export async function sqlJobComplete(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  attempt: JobAttempt,
  worker: string,
  outcome: JobOutcome,
): Promise<boolean> {
  if (!/^\d+$/.test(attempt.jobId)) return false;
  const now = ctx.clock.now();
  const [row] = await runSql(
    ctx.db,
    completeJobStatement({
      root: ctx.namespace.root,
      jobId: attempt.jobId,
      attempt: attempt.attempt,
      worker,
      outcome,
      now: encodeInstant(now),
      scopeId: ctx.scope.level === 'namespace' ? null : ctx.scopeId(),
    }),
  );
  if (row === undefined) return false;
  const laneId = String(row.lane_id);
  const group = groupKeyOfJob(
    row.group_id === null ? null : String(row.group_id),
    row.group_scope,
    String(row.scope_id),
  );
  const retryAfter =
    outcome.kind === 'retry' && outcome.error.kind === 'rate_limited'
      ? outcome.error.retryAfter
      : undefined;
  buffer.defer(async () => {
    const lanes = sqlLaneChanges();
    lanes.done(laneId, 1);
    await sqlSettleLanes(ctx, lanes);
    if (group !== undefined) {
      await sqlReleaseGroups(ctx, [
        {
          ...group,
          by: 1,
          ...(retryAfter === undefined
            ? {}
            : { blockedUntil: now.add({ milliseconds: Math.ceil(retryAfter * 1000) }) }),
        },
      ]);
    }
  });
  if (outcome.kind !== 'retry' && row.ordering === 'fifo-per-key' && row.key !== null) {
    await sqlJobRelease(ctx, buffer, laneId, String(row.key));
  }
  return true;
}
