import type { PostgresStatement } from './begin-unit-statements.ts';
import { queuedJobsCount } from './queued-jobs-count.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * The queued count of one queue (`JobStore.queued`, section 9.5.5, `queuedJobStates`) in the unit's
 * scope, or in every scope for a namespace-scope unit (`scopeId` null). The count stops after
 * `take` rows. For one scope the index of framework step 0005 bounds the read by `take` (see
 * `queuedJobsCount`). A namespace-scope read has no such bound: the index leads with the scope, so
 * it walks the index entries of every scope, or the rows of `kw_jobs`, until it has `take` matches
 * or runs out. The count is text.
 */
export function queuedJobsStatement(
  rootName: string,
  queue: string,
  scopeId: string | null,
  take: number,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  const count = queuedJobsCount(root, {
    queue: '$1::text',
    scope: '$2::uuid',
    limit: '$3::integer',
  });
  return {
    sql: `select (${count})::text as queued`,
    parameters: [queue, scopeId, take],
  };
}
