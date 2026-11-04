import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Jobs of the group stopped running: its `running` count drops by `by` under the row's lock, and
 * the group is blocked until `blockedUntil` when a `rate_limited` failure asked for it (9.5.4).
 * The count never goes below zero. The statement answers the row it moved, so a missing or hidden
 * group row is noticed.
 */
export function releaseGroupStatement(
  rootName: string,
  groupId: string,
  scopeId: string | null,
  blockedUntil: string | null,
  by: number,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `update ${root}.kw_job_groups set running = greatest(running - $4::integer, 0),
  blocked_until = coalesce($3::timestamptz, blocked_until)
where id = $1 and scope_id is not distinct from $2::uuid
returning id`,
    parameters: [groupId, scopeId, blockedUntil, String(by)],
  };
}
