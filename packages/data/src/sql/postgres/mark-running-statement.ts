import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** Jobs become `running` with the taker's worker, their next attempt and a lease; `started_at` is the instant of this take, so a run time excludes retry back-off and lost-lease waits. */
export function markRunningStatement(
  rootName: string,
  worker: string,
  leaseUntil: string,
  now: string,
  jobIds: readonly string[],
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `update ${root}.kw_jobs set state = 'running', worker = $1, attempt = attempt + 1,
  lease_until = $2::timestamptz, started_at = $3::timestamptz
where id = any ($4::bigint[])`,
    parameters: [worker, leaseUntil, now, jobIds],
  };
}
