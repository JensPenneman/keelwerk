import { ns } from './ns.ts';

/** One available job per lane of the scope in `$1`. */
export const enqueueJob = `insert into ${ns}.kw_jobs (scope_id, lane_id, queue, kind, state, principal, causation, build_id, revision, input, created_at)
  select scope_id, id, queue, 'action', 'available', '{}', '{}', 'b', 1, '{}', now() from ${ns}.kw_job_lanes where scope_id = $1`;
