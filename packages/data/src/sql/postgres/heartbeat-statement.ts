import type { JobAttempt } from '@keelwerk/core';
import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Renews the leases of the worker's running attempts in one statement (9.5.4), conditional on
 * (worker, attempt); answers the attempts whose lease still holds.
 */
export function heartbeatStatement(
  rootName: string,
  attempts: readonly JobAttempt[],
  worker: string,
  leaseUntil: string,
  scopeId: string | null,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `update ${root}.kw_jobs j set lease_until = $3::timestamptz
from unnest($1::bigint[], $2::integer[]) as a (id, attempt)
where j.id = a.id and j.attempt = a.attempt and j.worker = $4 and j.state = 'running'
  and ($5::uuid is null or j.scope_id = $5::uuid)
returning j.id::text as id, j.attempt`,
    parameters: [
      attempts.map((attempt) => attempt.jobId),
      attempts.map((attempt) => String(attempt.attempt)),
      leaseUntil,
      worker,
      scopeId,
    ],
  };
}
