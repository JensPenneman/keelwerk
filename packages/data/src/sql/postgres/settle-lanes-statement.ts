import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** A lane and how much its running load changes: attempts that ended (`done`) or were taken back (`taken`). */
export interface LaneSettlement {
  readonly laneId: string;
  /** Added to the lane's `done` counter. */
  readonly done: number;
  /** Added to the lane's `taken`; negative when a lost lease returns a job to `available`. */
  readonly taken: number;
}

/**
 * Applies completions and reclaims to the lanes (9.5.2): `done` counters and, for taken-back
 * attempts, `taken`. Each lane's counter rows are locked first in ascending lane id, so units that
 * settle the same lanes take their locks in one order and cannot deadlock. The statement answers
 * the number of lanes it moved; a lane row hidden from the unit by row-level security matches
 * nothing and would otherwise lose the count silently.
 */
export function settleLanesStatement(
  rootName: string,
  lanes: readonly LaneSettlement[],
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  const sorted = [...lanes].sort((a, b) => (BigInt(a.laneId) < BigInt(b.laneId) ? -1 : 1));
  return {
    sql: `with settlement as (
  select * from unnest($1::bigint[], $2::bigint[], $3::bigint[]) as s (lane_id, done, taken)
), locked_lanes as (
  select l.id from ${root}.kw_job_lanes l
  where l.id in (select lane_id from settlement) and exists (select 1 from settlement s where s.lane_id = l.id and s.taken <> 0)
  order by l.id for update
), locked_counts as (
  select c.lane_id from ${root}.kw_job_lane_counts c
  where c.kind = 'done' and c.lane_id in (select lane_id from settlement) order by c.lane_id for update
), counted as (
  update ${root}.kw_job_lane_counts c set value = c.value + s.done
  from settlement s where c.lane_id = s.lane_id and c.kind = 'done' and c.lane_id in (select lane_id from locked_counts)
  returning c.lane_id
), taken as (
  update ${root}.kw_job_lanes l set taken = l.taken + s.taken
  from settlement s where l.id = s.lane_id and s.taken <> 0 and l.id in (select id from locked_lanes)
  returning l.id
)
select (select count(*) from counted)::text as counted, (select count(*) from taken)::text as taken`,
    parameters: [
      sorted.map((lane) => lane.laneId),
      sorted.map((lane) => String(lane.done)),
      sorted.map((lane) => String(lane.taken)),
    ],
  };
}
