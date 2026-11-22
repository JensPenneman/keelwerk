import { queuedJobStates } from './queued-job-states.ts';

/**
 * A scalar select that counts the queued jobs (section 9.5.5, `queuedJobStates`) of `queue` in one
 * scope (or in every scope when `scope` is null), stopping after `limit` of them: the number is
 * `limit` at most. For one scope the index of framework step 0005 bounds the scan by `limit`, with
 * the exceptions of section 9.5.5. With a null scope nothing bounds the scan by `limit`: the index
 * leads with the scope, so the scan passes the entries of every scope's jobs, or reads the rows
 * of `kw_jobs`, until it has `limit` matches or runs out; only a namespace-scope unit asks that.
 * The arguments are SQL expressions (a parameter or a column of the outer query); the statement of
 * `JobStore.queued` and the queued cap of the commit tail both count through it.
 */
export function queuedJobsCount(
  root: string,
  expressions: { readonly queue: string; readonly scope: string; readonly limit: string },
): string {
  const { queue, scope, limit } = expressions;
  return `select count(*) from (
  select 1 from ${root}.kw_jobs j
  where j.queue = ${queue} and (${scope} is null or j.scope_id = ${scope})
    and j.state in ${queuedJobStates}
  limit ${limit}
) q`;
}
