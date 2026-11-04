import { ns } from './ns.ts';

/** The two counters of every lane of the scope in `$1`. */
export const laneCounts = `insert into ${ns}.kw_job_lane_counts (lane_id, kind, scope_id, value)
  select l.id, k.kind, l.scope_id, 0 from ${ns}.kw_job_lanes l cross join (values ('enqueued'), ('done')) as k (kind) where l.scope_id = $1`;
