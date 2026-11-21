import type { PostgresStatement } from './begin-unit-statements.ts';
import { jobGroupScopeSql } from './job-group-scope.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** What the reclaim writes: the jobs that return, the jobs that die, and the lanes that gained a follower. */
export interface ReclaimInput {
  readonly root: string;
  /** The jobs that return to `available` with the attempt counted as lost. */
  readonly returning: readonly string[];
  /** The jobs that become dead letters. */
  readonly dying: readonly string[];
  /** One lane id per follower that a dying FIFO head's end made available. */
  readonly followerLanes: readonly string[];
  readonly now: string;
  /** The error of a dead letter, as JSON. */
  readonly deadError: string;
}

/**
 * Reclaims the running jobs whose lease ended (9.5.4), in the take's unit, for jobs that
 * `reclaimAttemptStatement` found `ready`: it holds their job rows, the lane rows of the returning
 * jobs, the `done` counter rows of the lanes of the dying jobs, the group rows and the `enqueued`
 * counter rows of the lanes that gained a follower, so nothing here waits. Each job in `returning`
 * returns to `available` with its lost-lease count raised and leaves its lane's `taken`; each job in
 * `dying` becomes a dead letter that keeps its input, counts on its lane's `done` and writes a `dead`
 * history row with the error (the dead-letter rule is the attempt's, its one place); every job gives
 * its group a running slot back, never below zero, and every follower counts on its lane's
 * `enqueued`. The statement answers the reclaimed jobs.
 */
export function reclaimStatement(input: ReclaimInput): PostgresStatement {
  const root = quoteIdentifier(input.root);
  return {
    sql: `with lost as (
  update ${root}.kw_jobs j set lost_leases = j.lost_leases + 1,
    state = case when j.id = any ($2::bigint[]) then 'dead' else 'available' end,
    worker = null, lease_until = null
  where j.id = any ($1::bigint[] || $2::bigint[])
  returning j.id, j.scope_id, j.lane_id, j.queue, j.kind, j.state, j.attempt, j.started_at, j.group_id,
    ${jobGroupScopeSql('j')} as group_scope_id
), history as (
  insert into ${root}.kw_job_history (scope_id, job_id, queue, kind, outcome, attempts, started_at, finished_at, error)
  select scope_id, id, queue, kind, 'dead', attempt, started_at, $3::timestamptz, $4::jsonb from lost where state = 'dead'
  on conflict (scope_id, job_id) do update set outcome = excluded.outcome, attempts = excluded.attempts,
    started_at = excluded.started_at, finished_at = excluded.finished_at, error = excluded.error
), taken as (
  update ${root}.kw_job_lanes l set taken = l.taken - n.n
  from (select lane_id, count(*) as n from lost where state = 'available' group by lane_id) n where l.id = n.lane_id
), done as (
  update ${root}.kw_job_lane_counts c set value = c.value + n.n
  from (select lane_id, count(*) as n from lost where state = 'dead' group by lane_id) n
  where c.lane_id = n.lane_id and c.kind = 'done'
), slots as (
  update ${root}.kw_job_groups g set running = greatest(g.running - n.n, 0)
  from (select group_id, group_scope_id, count(*) as n from lost where group_id is not null group by group_id, group_scope_id) n
  where g.id = n.group_id and g.scope_id is not distinct from n.group_scope_id
), followers as (
  update ${root}.kw_job_lane_counts c set value = c.value + n.n
  from (select lane_id, count(*) as n from unnest($5::bigint[]) as f (lane_id) group by lane_id) n
  where c.lane_id = n.lane_id and c.kind = 'enqueued'
)
select id::text as id, state, group_id from lost order by id`,
    parameters: [input.returning, input.dying, input.now, input.deadError, input.followerLanes],
  };
}
