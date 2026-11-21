import type { JobAttempt, JobOutcome } from '@keelwerk/core';
import { encodeInstant } from './encode-instant.ts';
import { groupKeyOfJob } from './group-key-of-job.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { completeJobStatement } from './postgres/complete-job-statement.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlJobKeyLock } from './sql-job-key-lock.ts';
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
 * releases the next job of its key when the queue orders by key. For such a job the key's advisory
 * lock is taken before the completion statement (lock, then row, as an enqueue and a cancel by key
 * take it: the cancel deletes a running head of the timers and hooks queues): an append that is still open decides first and the completion then releases its job, or the
 * completion commits first and the append sees no head. A retry keeps the head and takes no lock.
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
  if (outcome.kind !== 'retry') {
    const root = quoteIdentifier(ctx.namespace.root);
    const scopeId = jobUnitScopeId(ctx);
    const [head] = await runSql(ctx.db, {
      sql: `select lane_id::text as lane_id, key from ${root}.kw_jobs
where id = $1::bigint and state = 'running' and ordering = 'fifo-per-key' and key is not null
  and ($2::uuid is null or scope_id = $2::uuid)`,
      parameters: [attempt.jobId, scopeId],
    });
    if (head !== undefined) await sqlJobKeyLock(ctx, String(head.lane_id), String(head.key));
  }
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
  // The slot of the lane, and of the job's group, comes back at the tail: a group spans queues.
  if (group === undefined) buffer.ready(String(row.queue));
  else buffer.readyAnywhere();
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
    await sqlJobRelease(ctx, buffer, String(row.queue), laneId, String(row.key));
  }
  return true;
}
