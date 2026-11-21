import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** What the promotion needs: the namespace root, the queue, how many jobs at most and the unit's clock. */
export interface PromoteInput {
  readonly root: string;
  readonly queue: string;
  readonly limit: number;
  /** The instant jobs are due at or before, an ISO timestamp. */
  readonly now: string;
  /** The unit's scope id; null in a namespace-scope unit, which reaches every scope. */
  readonly scopeId: string | null;
}

/**
 * Promotion (9.5.2): the oldest due `scheduled` jobs of the queue, at most `limit`, and the
 * `enqueued` counter rows of their lanes are locked with `skip locked`, so two fetchers never promote
 * one job twice and a promotion never waits for a row another unit holds: only the due jobs of the
 * lanes whose counter row it got become `available`, and each such lane's counter grows by them in
 * this statement, so the unit's own take sees the promoted jobs. A due job of a lane whose counter
 * row is held stays `scheduled` for a later promotion. The limit counts the due jobs before the lane
 * filter, so the due jobs of a lane whose counter row is held also use up the limit for the lanes
 * whose row it got. The statement answers one row per lane that has a due job among the ones it
 * took: the number it promoted there (0 when the lane's counter row is held).
 */
export function promoteStatement(input: PromoteInput): PostgresStatement {
  const root = quoteIdentifier(input.root);
  return {
    sql: `with due as materialized (
  select id, lane_id from ${root}.kw_jobs
  where queue = $1::text and state = 'scheduled' and run_at <= $2::timestamptz
    and ($4::uuid is null or scope_id = $4::uuid)
  order by run_at, id limit $3::integer for update skip locked
), counts as materialized (
  select c.lane_id from ${root}.kw_job_lane_counts c
  where c.kind = 'enqueued' and c.lane_id in (select lane_id from due)
  order by c.lane_id for update skip locked
), moved as (
  update ${root}.kw_jobs j set state = 'available'
  from due where j.id = due.id and due.lane_id in (select lane_id from counts)
  returning j.lane_id
), gained as (
  select lane_id, count(*) as n from moved group by lane_id
), counted as (
  update ${root}.kw_job_lane_counts c set value = c.value + g.n
  from gained g where c.lane_id = g.lane_id and c.kind = 'enqueued'
)
select d.lane_id::text as lane_id, coalesce(g.n, 0)::text as n
from (select distinct lane_id from due) d left join gained g on g.lane_id = d.lane_id
order by d.lane_id`,
    parameters: [input.queue, input.now, String(input.limit), input.scopeId],
  };
}
