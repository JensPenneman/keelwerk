import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** A group row to lock: its declared id and its scope id, null for a group that spans the namespace. */
export interface GroupRowKey {
  readonly id: string;
  readonly scopeId: string | null;
}

/**
 * Locks the given group rows in id order (scope after id, the namespace-wide row first) with
 * `skip locked`, so a row another unit holds, a re-limit that is still open or another taker, is not
 * waited for, and answers their counters (14.3.9: group limits are counted under the group's row
 * lock). `skip locked` cannot tell a held row from a missing one, so the statement answers one row
 * per wanted group: `present` says the row exists, and the counters are null when the row is held
 * (or missing) and the unit does not hold it.
 */
export function lockGroupsStatement(
  rootName: string,
  keys: readonly GroupRowKey[],
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `with wanted as (
  select * from unnest($1::text[], $2::uuid[]) as k (id, scope_id)
), locked as materialized (
  select g.id, g.scope_id, g.concurrency, g.running, g.rate, g.tokens, g.refilled_at, g.blocked_until
  from ${root}.kw_job_groups g
  where exists (select 1 from wanted k where k.id = g.id and k.scope_id is not distinct from g.scope_id)
  order by g.id, g.scope_id nulls first
  for update of g skip locked
)
select w.id, w.scope_id::text as scope_id,
  exists (select 1 from ${root}.kw_job_groups p where p.id = w.id and p.scope_id is not distinct from w.scope_id) as present,
  l.id is not null as locked, l.concurrency, l.running, l.rate, l.tokens, l.refilled_at, l.blocked_until
from wanted w left join locked l on l.id = w.id and l.scope_id is not distinct from w.scope_id
order by w.id, w.scope_id nulls first`,
    parameters: [keys.map((key) => key.id), keys.map((key) => key.scopeId)],
  };
}
