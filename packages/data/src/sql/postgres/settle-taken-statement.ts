import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';
import type { LaneSettlement } from './settle-done-statement.ts';

/**
 * Applies `taken` to the lanes of attempts that were taken back (a drain's release). A take does not
 * come here: its reclaim locks and writes the lane rows it needs without waiting
 * (`reclaimAttemptStatement`). The lane rows are locked in ascending lane id, `for no key update`,
 * not `for update`, for the reason the take gives (`fairTakeStatement`): a unit that enqueues into a
 * lane holds `for key share` on its row, which `for update` would wait for, so a drain that
 * releases an attempt would wait for every open enqueue unit of the lane. Of the lane row the
 * statement changes `taken` only, which no key contains. The statement answers the number of lanes
 * it moved.
 */
export function settleTakenStatement(
  rootName: string,
  lanes: readonly LaneSettlement[],
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  const sorted = [...lanes].sort((a, b) => (BigInt(a.laneId) < BigInt(b.laneId) ? -1 : 1));
  return {
    sql: `with settlement as (
  select * from unnest($1::bigint[], $2::bigint[]) as s (lane_id, taken)
), locked_lanes as (
  select l.id from ${root}.kw_job_lanes l
  where l.id in (select lane_id from settlement) order by l.id for no key update
), taken as (
  update ${root}.kw_job_lanes l set taken = l.taken + s.taken
  from settlement s where l.id = s.lane_id and l.id in (select id from locked_lanes)
  returning l.id
)
select count(*)::text as taken from taken`,
    parameters: [sorted.map((lane) => lane.laneId), sorted.map((lane) => String(lane.taken))],
  };
}
