import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * The lookup of `JobStore.keyed`: a job of the queue with the key that is alive (scheduled,
 * available, waiting or running) in the unit's scope, or in every scope for a namespace-scope unit
 * (`scopeId` null). Answers one row with `found` when there is one.
 */
export function keyedJobStatement(
  rootName: string,
  queue: string,
  key: string,
  scopeId: string | null,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `select 1 as found from ${root}.kw_jobs j
where j.queue = $1::text and j.key = $2::text and ($3::uuid is null or j.scope_id = $3::uuid)
  and j.state in ('scheduled', 'available', 'waiting', 'running')
limit 1`,
    parameters: [queue, key, scopeId],
  };
}
