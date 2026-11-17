import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * The queued count of one queue (`JobStore.queued`): the jobs that wait to run (scheduled,
 * available or waiting; never running or dead) in the unit's scope, or in every scope for a
 * namespace-scope unit (`scopeId` null). The inner select stops after `take` rows, so the read is
 * bounded by the matches it needs, not by the rows of the queue. The count is text.
 */
export function queuedJobsStatement(
  rootName: string,
  queue: string,
  scopeId: string | null,
  take: number,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `select count(*)::text as queued from (
  select 1 from ${root}.kw_jobs j
  where j.queue = $1::text and ($2::uuid is null or j.scope_id = $2::uuid)
    and j.state in ('scheduled', 'available', 'waiting')
  limit $3::integer
) q`,
    parameters: [queue, scopeId, take],
  };
}
