import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Statistics per queue and capability set (21.4): the running count is the lane's `taken` less its
 * `done`; due jobs, the oldest wait, the next time and the arrivals of the last minute come from the
 * queue's jobs; the mean run time from the history rows with a start. The SLO is configuration the
 * store does not hold. Times are seconds as double precision; counts are text.
 */
export function jobStatsStatement(
  rootName: string,
  queue: string | null,
  now: string,
  scopeId: string | null,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `with lane_load as (
  select l.id, l.queue, l.capability_set, l.taken - d.value as running from ${root}.kw_job_lanes l
  join ${root}.kw_job_lane_counts d on d.lane_id = l.id and d.kind = 'done'
  where ($1::text is null or l.queue = $1::text) and ($3::uuid is null or l.scope_id = $3::uuid)
), job_load as (
  select j.lane_id,
    count(*) filter (where j.state = 'available' and j.run_at <= $2::timestamptz) as due,
    max(extract(epoch from ($2::timestamptz - j.run_at))) filter (where j.state = 'available' and j.run_at <= $2::timestamptz) as oldest,
    count(*) filter (where j.created_at >= $2::timestamptz - interval '60 seconds') as arrivals,
    min(j.run_at) filter (where j.state in ('scheduled', 'available')) as next_due
  from ${root}.kw_jobs j
  where ($1::text is null or j.queue = $1::text) and ($3::uuid is null or j.scope_id = $3::uuid)
  group by j.lane_id
), ran as (
  select h.queue, avg(extract(epoch from (h.finished_at - h.started_at))) as mean_run
  from ${root}.kw_job_history h where h.started_at is not null and ($3::uuid is null or h.scope_id = $3::uuid) group by h.queue
)
select ll.queue, ll.capability_set,
  coalesce(sum(jl.due), 0)::text as due,
  coalesce(max(jl.oldest), 0)::double precision as oldest,
  coalesce(sum(jl.arrivals), 0)::text as arrivals,
  coalesce(max(r.mean_run), 0)::double precision as mean_run,
  sum(ll.running)::text as running,
  min(jl.next_due) as next_due
from lane_load ll left join job_load jl on jl.lane_id = ll.id left join ran r on r.queue = ll.queue
group by ll.queue, ll.capability_set order by ll.queue, ll.capability_set`,
    parameters: [queue, now, scopeId],
  };
}
