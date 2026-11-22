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
 * Applies the `done` counters of completions and cancels to the lanes (9.5.2). The counter rows are
 * locked first, in ascending lane id, so units that settle the same lanes take their locks in one
 * order and cannot deadlock. The statement answers the number of lanes it moved; a lane row hidden
 * from the unit by row-level security matches nothing and would otherwise lose the count silently.
 * It touches the counter rows only: the lane rows come after the group rows (`settleTakenStatement`).
 */
export function settleDoneStatement(
  rootName: string,
  lanes: readonly LaneSettlement[],
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  const sorted = [...lanes].sort((a, b) => (BigInt(a.laneId) < BigInt(b.laneId) ? -1 : 1));
  return {
    sql: `with settlement as (
  select * from unnest($1::bigint[], $2::bigint[]) as s (lane_id, done)
), locked_counts as (
  select c.lane_id from ${root}.kw_job_lane_counts c
  where c.kind = 'done' and c.lane_id in (select lane_id from settlement) order by c.lane_id for update
), counted as (
  update ${root}.kw_job_lane_counts c set value = c.value + s.done
  from settlement s where c.lane_id = s.lane_id and c.kind = 'done' and c.lane_id in (select lane_id from locked_counts)
  returning c.lane_id
)
select count(*)::text as counted from counted`,
    parameters: [sorted.map((lane) => lane.laneId), sorted.map((lane) => String(lane.done))],
  };
}
