import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** The taken jobs of one lane, for the lane's `taken` and virtual time. */
export interface LaneTake {
  readonly laneId: string;
  readonly jobs: number;
  /** The summed `cost` of the jobs. */
  readonly cost: number;
}

/**
 * The lanes of a take add the jobs to `taken` and cost over weight to the virtual time, lifted to
 * `$vmin` first so idleness earns no credit (9.5.3). The lane rows are locked by the pick. The
 * statement answers the number of lanes it moved.
 */
export function advanceLanesStatement(
  rootName: string,
  vmin: number,
  lanes: readonly LaneTake[],
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `with advanced as (
  update ${root}.kw_job_lanes l set taken = l.taken + x.n,
    vtime = greatest(l.vtime, $1::double precision) + x.cost::double precision / l.weight
  from unnest($2::bigint[], $3::bigint[], $4::bigint[]) as x (lane, n, cost)
  where l.id = x.lane returning l.id
)
select count(*)::text as moved from advanced`,
    parameters: [
      String(vmin),
      lanes.map((lane) => lane.laneId),
      lanes.map((lane) => String(lane.jobs)),
      lanes.map((lane) => String(lane.cost)),
    ],
  };
}
