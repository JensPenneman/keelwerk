import { encodeInstant } from './encode-instant.ts';
import { groupKeyOfJob } from './group-key-of-job.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { reclaimStatement } from './postgres/reclaim-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlJobRelease } from './sql-job-release.ts';
import { sqlLaneChanges } from './sql-lane-changes.ts';
import { sqlLostLeaseError } from './sql-lost-lease-error.ts';
import type { GroupRelease } from './sql-release-groups.ts';
import { sqlSettleLanes } from './sql-settle-lanes.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * The first step of a take (9.5.4): the running jobs of the queue whose lease ended return to
 * `available` with the attempt counted as lost (`core.job_lease_lost`), and the third consecutive
 * loss makes a job a dead letter. A returned job leaves its lane's `taken`, a dead one counts as
 * done; both owe their group a slot, which the caller gives back under the group locks of its own
 * (a take locks every group row in one id-ordered pass), and a dead job's FIFO successor is released.
 * Answers the slots owed.
 */
export async function sqlJobReclaim(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  queue: string,
  now: Temporal.Instant,
): Promise<readonly GroupRelease[]> {
  const rows = await runSql(
    ctx.db,
    reclaimStatement(
      ctx.namespace.root,
      queue,
      encodeInstant(now),
      JSON.stringify(sqlLostLeaseError),
      jobUnitScopeId(ctx),
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
  await sqlSettleLanes(ctx, lanes);
  for (const row of rows) {
    if (row.state === 'dead' && row.ordering === 'fifo-per-key' && row.key !== null) {
      await sqlJobRelease(ctx, buffer, String(row.lane_id), String(row.key));
    }
  }
  return releases;
}
