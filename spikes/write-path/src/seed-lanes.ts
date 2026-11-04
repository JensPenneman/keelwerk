import type { Client } from 'pg';
import { deterministicUuid } from './deterministic-uuid.ts';
import { namespaceRoot as ns } from './namespace-root.ts';

/**
 * Creates `lanes` lanes of one queue and capability set (one tenant scope per lane, normal priority,
 * weight 1) with `jobsPerLane` available jobs each, and their `enqueued` and `done` counters. The
 * lanes belong to `scopes` when given (one per lane), else to scopes derived from the lane index.
 * Returns the lane ids in creation order.
 */
export async function seedLanes(
  admin: Client,
  options: {
    readonly queue: string;
    readonly capabilitySet: string;
    readonly lanes: number;
    readonly jobsPerLane: number;
    readonly cap: number;
    readonly scopes?: readonly string[] | undefined;
  },
): Promise<readonly string[]> {
  const scopes =
    options.scopes ??
    Array.from({ length: options.lanes }, (_, lane) => deterministicUuid(4, lane, 0));
  const created = await admin.query<{ id: string }>(
    `insert into ${ns}.kw_job_lanes (scope_id, queue, capability_set, priority, cap, weight)
     select scope, $2, $3, 1, $4, 1 from unnest($1::uuid[]) with ordinality as s (scope, ord) order by ord
     returning id::text as id`,
    [scopes, options.queue, options.capabilitySet, options.cap],
  );
  const laneIds = created.rows.map((row) => row.id);
  await admin.query(
    `insert into ${ns}.kw_job_lane_counts (lane_id, kind, scope_id, value)
     select l.id, k.kind, l.scope_id, case k.kind when 'enqueued' then $2 else 0 end
     from ${ns}.kw_job_lanes l cross join (values ('enqueued'), ('done')) as k (kind)
     where l.id = any ($1::bigint[])`,
    [laneIds, options.jobsPerLane],
  );
  await admin.query(
    `insert into ${ns}.kw_jobs (scope_id, lane_id, queue, state, revision, input, run_at)
     select l.scope_id, l.id, l.queue, 'available', 1, '{}'::jsonb, now() - (n || ' milliseconds')::interval
     from ${ns}.kw_job_lanes l cross join generate_series(1, $2) as n
     where l.id = any ($1::bigint[])`,
    [laneIds, options.jobsPerLane],
  );
  await admin.query(`analyze ${ns}.kw_jobs, ${ns}.kw_job_lanes, ${ns}.kw_job_lane_counts`);
  return laneIds;
}
