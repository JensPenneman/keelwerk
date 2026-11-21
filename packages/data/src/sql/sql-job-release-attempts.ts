import type { JobAttempt } from '@keelwerk/core';
import { groupKeyOfJob } from './group-key-of-job.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { releaseAttemptsStatement } from './postgres/release-attempts-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlLaneChanges } from './sql-lane-changes.ts';
import type { GroupRelease } from './sql-release-groups.ts';
import { sqlReleaseGroups } from './sql-release-groups.ts';
import { sqlSettleLanes } from './sql-settle-lanes.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * `JobStore.release` on the PostgreSQL dialect (21.6 step 4): one statement gives the worker's
 * running attempts back to `available` and the queues are recorded as takeable (`readied` answers
 * `undefined`, cannot name, when a job is in a group, as for a completion); the lanes' `taken`
 * counts and the groups' running slots follow at the end of the unit, before the commit tail, as a
 * completion's do.
 */
export async function sqlJobReleaseAttempts(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  attempts: readonly JobAttempt[],
  worker: string,
): Promise<readonly JobAttempt[]> {
  const valid = attempts.filter((attempt) => /^\d+$/.test(attempt.jobId));
  if (valid.length === 0) return [];
  const rows = await runSql(
    ctx.db,
    releaseAttemptsStatement(ctx.namespace.root, valid, worker, jobUnitScopeId(ctx)),
  );
  if (rows.length === 0) return [];
  const lanes = sqlLaneChanges();
  const releases: GroupRelease[] = [];
  const queues = new Set<string>();
  for (const row of rows) {
    lanes.taken(String(row.lane_id), -1);
    const group = groupKeyOfJob(
      row.group_id === null ? null : String(row.group_id),
      row.group_scope,
      String(row.scope_id),
    );
    if (group === undefined) queues.add(String(row.queue));
    else releases.push({ ...group, by: 1 });
  }
  // The released jobs are takeable again; a group's slot may be what a job of another queue waits for.
  if (releases.length > 0) buffer.readyAnywhere();
  for (const queue of queues) buffer.ready(queue);
  buffer.defer(async () => {
    await sqlSettleLanes(ctx, lanes);
    await sqlReleaseGroups(ctx, releases);
  });
  const moved = new Set(rows.map((row) => `${String(row.id)}:${Number(row.attempt)}`));
  return valid.filter((attempt) => moved.has(`${attempt.jobId}:${attempt.attempt}`));
}
