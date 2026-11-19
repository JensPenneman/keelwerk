import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Deletes the `kw_job_history` rows of one scope finished before `before`, lowest job id first, at
 * most `limit`, and returns one row per row deleted. Only the history table is touched.
 */
export function purgeJobHistoryStatement(
  rootName: string,
  input: { readonly scopeId: string; readonly before: string; readonly limit: number },
): PostgresStatement {
  const table = `${quoteIdentifier(rootName)}.kw_job_history`;
  return {
    sql: `with doomed as (
  select h.job_id from ${table} as h
  where h.scope_id = $1::uuid and h.finished_at < $2::timestamptz
  order by h.job_id
  limit $3::integer
)
delete from ${table} as history using doomed
where history.scope_id = $1::uuid and history.job_id = doomed.job_id
returning 1`,
    parameters: [input.scopeId, input.before, input.limit],
  };
}
