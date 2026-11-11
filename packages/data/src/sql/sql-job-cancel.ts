import { timerQueue } from '@keelwerk/core';
import { encodeInstant } from './encode-instant.ts';
import { groupKeyOfJob } from './group-key-of-job.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlLaneChanges } from './sql-lane-changes.ts';
import { sqlReleaseGroups } from './sql-release-groups.ts';
import { sqlSettleLanes } from './sql-settle-lanes.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** Which pending jobs to cancel: those of a queue with a key, or those with these ids. */
export type SqlJobCancelTarget =
  | { readonly queue: string; readonly key: string }
  | { readonly ids: readonly string[] };

/** A job that was cancelled. */
export interface SqlCancelledJob {
  readonly id: string;
  readonly laneId: string;
  readonly state: string;
  readonly ordering: string;
  readonly key: string | null;
}

/**
 * Takes jobs out of the queue and writes their `cancelled` history rows, which never hold the input
 * (9.5.2): pending ones (`scheduled`, `available` or `waiting`) for ids or a key, and for a key of the
 * timers queue also the one `running` attempt (a timer never crosses scopes; in any other queue the
 * command may commit in another unit, so a running job is left to finish). A running job's row is deleted, so its worker's completion matches
 * nothing and answers a lost lease (the unit of a command that was running rolls back: exactly one
 * of the cancel and the command wins), and its next heartbeat is refused; its lane's `done` count
 * and its group's running slot are given back at the commit tail. A job that was `available` leaves
 * its lane's `enqueued` count there too, beside the other changes of the unit. A namespace-scope
 * unit cancels across scopes (the maintenance policy of the queue tables); every other unit only
 * its own.
 */
export async function sqlJobCancel(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  target: SqlJobCancelTarget,
): Promise<readonly SqlCancelledJob[]> {
  const root = quoteIdentifier(ctx.namespace.root);
  const parameters: unknown[] = [];
  const bind = (value: unknown, cast: string): string => {
    parameters.push(value);
    return `$${parameters.length}::${cast}`;
  };
  const conditions = [
    'ids' in target || target.queue !== timerQueue
      ? `state in ('scheduled', 'available', 'waiting')`
      : `state in ('scheduled', 'available', 'waiting', 'running')`,
  ];
  if ('ids' in target) {
    conditions.push(`id = any (${bind(target.ids, 'bigint[]')})`);
  } else {
    conditions.push(`queue = ${bind(target.queue, 'text')}`, `key = ${bind(target.key, 'text')}`);
  }
  if (ctx.scope.level !== 'namespace') {
    conditions.push(`scope_id = ${bind(ctx.scopeId(), 'uuid')}`);
  }
  const finished = bind(encodeInstant(ctx.clock.now()), 'timestamptz');
  const rows = await runSql(ctx.db, {
    sql: `with gone as (
  delete from ${root}.kw_jobs where ${conditions.join(' and ')}
  returning id, scope_id, lane_id, queue, kind, state, attempt, started_at, ordering, key, group_id, group_spec ->> 'scope' as group_scope
), history as (
  insert into ${root}.kw_job_history (scope_id, job_id, queue, kind, outcome, attempts, started_at, finished_at, error)
  select scope_id, id, queue, kind, 'cancelled', attempt, started_at, ${finished}, null from gone
)
select id::text as id, scope_id::text as scope_id, lane_id::text as lane_id, state, ordering, key, group_id, group_scope from gone order by id`,
    parameters,
  });
  const cancelled = rows.map((row) => ({
    id: String(row.id),
    laneId: String(row.lane_id),
    state: String(row.state),
    ordering: String(row.ordering),
    key: row.key === null ? null : String(row.key),
  }));
  for (const job of cancelled) {
    if (job.state === 'available') buffer.moveLane(job.laneId, -1);
  }
  const running = rows.filter((row) => row.state === 'running');
  if (running.length > 0) {
    buffer.defer(async () => {
      const lanes = sqlLaneChanges();
      for (const row of running) lanes.done(String(row.lane_id), 1);
      await sqlSettleLanes(ctx, lanes);
      const groups = running.flatMap((row) => {
        const group = groupKeyOfJob(
          row.group_id === null ? null : String(row.group_id),
          row.group_scope,
          String(row.scope_id),
        );
        return group === undefined ? [] : [{ ...group, by: 1 }];
      });
      if (groups.length > 0) await sqlReleaseGroups(ctx, groups);
    });
  }
  return cancelled;
}
