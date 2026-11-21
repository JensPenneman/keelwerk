import { lostLeaseWireError } from '@keelwerk/core';
import { encodeInstant } from './encode-instant.ts';
import { groupKeyOfJob } from './group-key-of-job.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { reclaimStatement } from './postgres/reclaim-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlJobKeyTryLock } from './sql-job-key-try-lock.ts';
import { sqlJobRelease } from './sql-job-release.ts';
import { sqlLaneChanges } from './sql-lane-changes.ts';
import type { GroupRelease } from './sql-release-groups.ts';
import { sqlSettleLanes } from './sql-settle-lanes.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * The first step of a take (9.5.4): the running jobs of the queue whose lease ended return to
 * `available` with the attempt counted as lost (`core.job_lease_lost`), and the third consecutive
 * loss makes a job a dead letter. A returned job leaves its lane's `taken`, a dead one counts as
 * done; both owe their group a slot, which the caller gives back under the group locks of its own
 * (a take locks every group row in one id-ordered pass), and a dead job's FIFO successor is released.
 * Answers the slots owed. A take never waits behind an open unit: the expired running jobs of FIFO
 * keys are reclaimed only for the keys whose advisory lock this unit gets without waiting
 * (`sqlJobKeyTryLock`, tried in one statement per key before the reclaim statement locks any row,
 * and the statement is limited to the keys that were got). A key whose lock another unit holds, an
 * append under it that is still open or a cancel, keeps its expired job `running` until a later take
 * gets the lock, as a take skips a row another unit holds; the job's own worker can still complete
 * it, which is fenced on worker and attempt. A lock tried for a key whose job is then not reclaimed (a
 * taker that holds the row, a lease renewed meanwhile) stays held until this unit ends, so it makes an
 * append or a cancel under that key wait for the take's commit.
 */
export async function sqlJobReclaim(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  queue: string,
  now: Temporal.Instant,
): Promise<readonly GroupRelease[]> {
  const expired = await runSql(ctx.db, {
    sql: `select distinct lane_id::text as lane_id, key from ${quoteIdentifier(ctx.namespace.root)}.kw_jobs
where queue = $1::text and state = 'running' and ordering = 'fifo-per-key' and key is not null
  and lease_until < $2::timestamptz and ($3::uuid is null or scope_id = $3::uuid)
order by lane_id::text, key`,
    parameters: [queue, encodeInstant(now), jobUnitScopeId(ctx)],
  });
  const lockedLanes: string[] = [];
  const lockedKeys: string[] = [];
  for (const row of expired) {
    const laneId = String(row.lane_id);
    const key = String(row.key);
    if (await sqlJobKeyTryLock(ctx, laneId, key)) {
      lockedLanes.push(laneId);
      lockedKeys.push(key);
    }
  }
  const rows = await runSql(
    ctx.db,
    reclaimStatement(
      ctx.namespace.root,
      queue,
      encodeInstant(now),
      JSON.stringify(lostLeaseWireError),
      jobUnitScopeId(ctx),
      lockedLanes,
      lockedKeys,
    ),
  );
  if (rows.length === 0) return [];
  const lanes = sqlLaneChanges();
  const releases: GroupRelease[] = [];
  for (const row of rows) {
    const dead = row.state === 'dead';
    if (dead) lanes.done(String(row.lane_id), 1);
    else lanes.taken(String(row.lane_id), -1);
    const group = groupKeyOfJob(
      row.group_id === null ? null : String(row.group_id),
      row.group_scope,
      String(row.scope_id),
    );
    if (group !== undefined) releases.push({ ...group, by: 1 });
  }
  if (releases.length > 0) buffer.readyAnywhere();
  else buffer.ready(queue);
  await sqlSettleLanes(ctx, lanes);
  for (const row of rows) {
    if (row.state === 'dead' && row.ordering === 'fifo-per-key' && row.key !== null) {
      await sqlJobRelease(ctx, buffer, queue, String(row.lane_id), String(row.key));
    }
  }
  return releases;
}
