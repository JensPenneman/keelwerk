import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** A FIFO key whose head left the queue: the lane and the key. */
export interface ReleasedKey {
  readonly laneId: string;
  readonly key: string;
}

/**
 * FIFO per key (9.1.2, 9.5.2): of each given key, the lowest `waiting` job becomes `available`, or
 * `scheduled` when its time has not come; one answer row per job it moved, with its lane and new
 * state. The one place that states the rule. Every statement that locks a `waiting` row (the
 * enqueue's policy read and coalesce, the replace's cancel by id, a cancel by key, an erasure, this
 * release) runs under the key's advisory lock, so the caller, which holds it, never waits for the
 * row it locks here.
 */
export function releaseNextJobStatement(
  rootName: string,
  keys: readonly ReleasedKey[],
  now: string,
  scopeId: string | null,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `with next as materialized (
  select (
    select w.id from ${root}.kw_jobs w
    where w.lane_id = k.lane_id and w.key = k.key and w.state = 'waiting' and ($4::uuid is null or w.scope_id = $4::uuid)
    order by w.id limit 1 for update
  ) as id
  from unnest($1::bigint[], $2::text[]) as k (lane_id, key)
)
update ${root}.kw_jobs j set state = case when j.run_at <= $3::timestamptz then 'available' else 'scheduled' end
from next n where j.id = n.id and ($4::uuid is null or j.scope_id = $4::uuid)
returning j.lane_id::text as lane_id, j.state`,
    parameters: [keys.map((key) => key.laneId), keys.map((key) => key.key), now, scopeId],
  };
}
