import { ns } from './ns.ts';

/** One group for the scope in `$1`. */
export const groupSeed = `insert into ${ns}.kw_job_groups (id, scope_id) values ('g:' || ($1::uuid)::text, $1::uuid)`;
