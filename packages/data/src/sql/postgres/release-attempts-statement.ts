import type { JobAttempt } from '@keelwerk/core';
import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Gives the worker's running attempts back in one statement (21.6 step 4), conditional on
 * (worker, attempt): each row returns to `available` with the attempt given back and no lease. The
 * statement answers the rows it moved, so the caller can correct the lanes' `taken` counts and the
 * groups' running counts.
 */
export function releaseAttemptsStatement(
  rootName: string,
  attempts: readonly JobAttempt[],
  worker: string,
  scopeId: string | null,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `update ${root}.kw_jobs j set state = 'available', attempt = greatest(j.attempt - 1, 0), worker = null, lease_until = null
from unnest($1::bigint[], $2::integer[]) as a (id, attempt)
where j.id = a.id and j.attempt = a.attempt and j.worker = $3 and j.state = 'running'
  and ($4::uuid is null or j.scope_id = $4::uuid)
returning j.id::text as id, a.attempt, j.lane_id::text as lane_id, j.queue, j.scope_id::text as scope_id,
  j.group_id, j.group_spec ->> 'scope' as group_scope`,
    parameters: [
      attempts.map((attempt) => attempt.jobId),
      attempts.map((attempt) => String(attempt.attempt)),
      worker,
      scopeId,
    ],
  };
}
