import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** How many consecutive lost leases make a job a dead letter (9.5.4). */
const deadAfterLostLeases = 3;

/**
 * Reclaims the running jobs of a queue whose lease ended before `now` (9.5.4): each returns to
 * `available` with its lost-lease count raised, or, at the third consecutive loss, becomes a dead
 * letter that keeps its input and writes a `dead` history row with the error in `$3`. Rows another
 * taker is reclaiming are skipped. The statement answers the reclaimed jobs, so the caller can
 * correct the lanes' `taken` and `done` counts and the groups' running counts.
 */
export function reclaimStatement(
  rootName: string,
  queue: string,
  now: string,
  deadError: string,
  scopeId: string | null,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `with expired as (
  select id from ${root}.kw_jobs
  where queue = $1::text and state = 'running' and lease_until < $2::timestamptz
    and ($4::uuid is null or scope_id = $4::uuid)
  order by id for update skip locked
), lost as (
  update ${root}.kw_jobs j set lost_leases = j.lost_leases + 1,
    state = case when j.lost_leases + 1 >= ${deadAfterLostLeases} then 'dead' else 'available' end,
    worker = null, lease_until = null
  from expired e where j.id = e.id
  returning j.id, j.scope_id, j.lane_id, j.queue, j.kind, j.state, j.attempt, j.started_at, j.ordering, j.key,
    j.group_id, j.group_spec ->> 'scope' as group_scope
), history as (
  insert into ${root}.kw_job_history (scope_id, job_id, queue, kind, outcome, attempts, started_at, finished_at, error)
  select scope_id, id, queue, kind, 'dead', attempt, started_at, $2::timestamptz, $3::jsonb from lost where state = 'dead'
  on conflict (scope_id, job_id) do update set outcome = excluded.outcome, attempts = excluded.attempts,
    started_at = excluded.started_at, finished_at = excluded.finished_at, error = excluded.error
)
select id::text as id, scope_id::text as scope_id, lane_id::text as lane_id, state, ordering, key, group_id, group_scope
from lost order by id`,
    parameters: [queue, now, deadError, scopeId],
  };
}
