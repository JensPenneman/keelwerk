import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** The lane a job joins: scope, queue, capability set and priority class (9.5.2). */
export interface SqlJobLaneKey {
  readonly queue: string;
  readonly capabilitySet: string;
  readonly priority: number;
  /** `queues.<q>.running`. */
  readonly cap: number;
}

/**
 * The id of the lane of the unit's scope, created with weight 1 and its two counter rows when it
 * is new (S-07). The common path is one read: a lane that exists with the same cap is not written,
 * because a write would hold its row lock until the unit ends and make every taker skip the lane
 * while an enqueue burst lasts (9.5.2). A changed cap is written; a lane another unit creates at
 * the same time is found again after the insert loses.
 */
export async function sqlJobLane(ctx: SqlUnitContext, key: SqlJobLaneKey): Promise<string> {
  const root = quoteIdentifier(ctx.namespace.root);
  const scopeId = ctx.scopeId();
  const find = async (): Promise<{ id: string; cap: number } | undefined> => {
    const [row] = await runSql(ctx.db, {
      sql: `select id::text as id, cap from ${root}.kw_job_lanes
where scope_id = $1::uuid and queue = $2 and capability_set = $3 and priority = $4::smallint`,
      parameters: [scopeId, key.queue, key.capabilitySet, String(key.priority)],
    });
    return row === undefined ? undefined : { id: String(row.id), cap: Number(row.cap) };
  };
  const found = await find();
  if (found !== undefined) {
    if (found.cap !== key.cap) {
      await runSql(ctx.db, {
        sql: `update ${root}.kw_job_lanes set cap = $2::integer where id = $1::bigint and scope_id = $3::uuid`,
        parameters: [found.id, String(key.cap), scopeId],
      });
    }
    return found.id;
  }
  const [created] = await runSql(ctx.db, {
    sql: `insert into ${root}.kw_job_lanes (scope_id, queue, capability_set, priority, cap, weight)
values ($1::uuid, $2, $3, $4::smallint, $5::integer, 1)
on conflict (queue, capability_set, scope_id, priority) do nothing
returning id::text as id`,
    parameters: [scopeId, key.queue, key.capabilitySet, String(key.priority), String(key.cap)],
  });
  if (created === undefined) {
    const raced = await find();
    if (raced === undefined) throw new Error('a lane vanished between two reads');
    return raced.id;
  }
  const id = String(created.id);
  await runSql(ctx.db, {
    sql: `insert into ${root}.kw_job_lane_counts (lane_id, kind, scope_id)
values ($1::bigint, 'enqueued', $2::uuid), ($1::bigint, 'done', $2::uuid)
on conflict (lane_id, kind) do nothing`,
    parameters: [id, scopeId],
  });
  return id;
}
