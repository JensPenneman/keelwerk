import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Asks whether the scope still has a `kw_job_history` row finished before `before`. A statement of
 * its own after the delete, so that under read committed it sees what other units have committed
 * since: rows another pass is still deleting stay visible and the answer errs towards "left".
 */
export function jobHistoryRemainsStatement(
  rootName: string,
  input: { readonly scopeId: string; readonly before: string },
): PostgresStatement {
  return {
    sql: `select exists (
  select 1 from ${quoteIdentifier(rootName)}.kw_job_history as h
  where h.scope_id = $1::uuid and h.finished_at < $2::timestamptz
) as more`,
    parameters: [input.scopeId, input.before],
  };
}
