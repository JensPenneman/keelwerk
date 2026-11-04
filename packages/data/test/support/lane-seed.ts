import { ns } from './ns.ts';

/** One lane for the scope in `$1`. */
export const laneSeed = `insert into ${ns}.kw_job_lanes (scope_id, queue, capability_set, priority, cap, weight) values ($1, 'q', 'c', 1, 5, 1)`;
