import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * What the take reads before its statement, in the take's unit (decision 117): `vmin`, the least
 * virtual time of the lanes of the queue and capability sets that have available work
 * (`enqueued > taken`), and `eligible`, the number of those lanes that are also under their cap,
 * which the take compares with the lanes it could lock to report the skipped ones.
 */
export function takeBoundsStatement(
  rootName: string,
  queue: string,
  capabilitySets: readonly string[],
  scopeId: string | null,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `select coalesce(min(l.vtime) filter (where e.value > l.taken), 0)::double precision as vmin,
  (count(*) filter (where e.value > l.taken and l.taken - d.value < l.cap))::text as eligible
from ${root}.kw_job_lanes l
join ${root}.kw_job_lane_counts e on e.lane_id = l.id and e.kind = 'enqueued'
join ${root}.kw_job_lane_counts d on d.lane_id = l.id and d.kind = 'done'
where l.queue = $1::text and l.capability_set = any ($2::text[])
  and ($3::uuid is null or l.scope_id = $3::uuid)`,
    parameters: [queue, capabilitySets, scopeId],
  };
}
