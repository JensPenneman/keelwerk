import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** A group row to lock: its declared id and its scope id, null for a group that spans the namespace. */
export interface GroupRowKey {
  readonly id: string;
  readonly scopeId: string | null;
}

/**
 * Locks the given group rows in id order (scope after id, the namespace-wide row first) and answers
 * their counters (14.3.9: group limits are counted under the group's row lock, taken in id order).
 */
export function lockGroupsStatement(
  rootName: string,
  keys: readonly GroupRowKey[],
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `select g.id, g.scope_id::text as scope_id, g.concurrency, g.running, g.rate, g.tokens, g.refilled_at, g.blocked_until
from ${root}.kw_job_groups g
where exists (
  select 1 from unnest($1::text[], $2::uuid[]) as k (id, scope_id)
  where k.id = g.id and k.scope_id is not distinct from g.scope_id)
order by g.id, g.scope_id nulls first
for update of g`,
    parameters: [keys.map((key) => key.id), keys.map((key) => key.scopeId)],
  };
}
