import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** The lane a job joins: scope, queue, capability set and priority class (9.5.2). */
export interface SqlJobLaneKey {
  readonly queue: string;
  readonly capabilitySet: string;
  readonly priority: number;
  /** `queues.<q>.running`. */
  readonly cap: number;
  /** `queues.<q>.weight`; absent: 1 for a new lane, an existing lane keeps its weight. */
  readonly weight?: number;
}

/**
 * The id of the lane of the unit's scope, created with its weight (1 when none is given) and its
 * two counter rows when it is new (S-07). An existing lane is only read: a changed cap, or a given
 * weight that differs from the lane's, is handed to the commit buffer, which writes the lanes'
 * rows at the end of the unit in the order of their ids (`sqlWriteLaneLimits`), because a write
 * here would hold the row's lock from the enqueue to the end of the unit, make every taker skip
 * the lane while an enqueue burst lasts and let two units that change two lanes in opposite order
 * wait for each other (9.5.2). What the unit gave the lane before counts as its cap and weight:
 * the last value given is the one written. A lane another unit creates at the same time is found
 * again after the insert loses. `written` says the row of an existing lane is to be written: the
 * caller reports the queue as made takeable, because a taker that met the held row skips the lane
 * and nothing else would bring it back before the poll (both adapters report it alike).
 */
export async function sqlJobLane(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  key: SqlJobLaneKey,
): Promise<{ readonly id: string; readonly written: boolean }> {
  const root = quoteIdentifier(ctx.namespace.root);
  const scopeId = ctx.scopeId();
  const find = async (): Promise<{ id: string; cap: number; weight: number } | undefined> => {
    const [row] = await runSql(ctx.db, {
      sql: `select id::text as id, cap, weight from ${root}.kw_job_lanes
where scope_id = $1::uuid and queue = $2 and capability_set = $3 and priority = $4::smallint`,
      parameters: [scopeId, key.queue, key.capabilitySet, String(key.priority)],
    });
    return row === undefined
      ? undefined
      : { id: String(row.id), cap: Number(row.cap), weight: Number(row.weight) };
  };
  const found = await find();
  if (found !== undefined) {
    const current = buffer.limitOf(found.id) ?? found;
    const weight = key.weight ?? current.weight;
    const written = current.cap !== key.cap || current.weight !== weight;
    if (written) buffer.limitLane({ laneId: found.id, cap: key.cap, weight });
    return { id: found.id, written };
  }
  const [created] = await runSql(ctx.db, {
    sql: `insert into ${root}.kw_job_lanes (scope_id, queue, capability_set, priority, cap, weight)
values ($1::uuid, $2, $3, $4::smallint, $5::integer, $6::integer)
on conflict (queue, capability_set, scope_id, priority) do nothing
returning id::text as id`,
    parameters: [
      scopeId,
      key.queue,
      key.capabilitySet,
      String(key.priority),
      String(key.cap),
      String(key.weight ?? 1),
    ],
  });
  if (created === undefined) {
    const raced = await find();
    if (raced === undefined) throw new Error('a lane vanished between two reads');
    return { id: raced.id, written: false };
  }
  const id = String(created.id);
  await runSql(ctx.db, {
    sql: `insert into ${root}.kw_job_lane_counts (lane_id, kind, scope_id)
values ($1::bigint, 'enqueued', $2::uuid), ($1::bigint, 'done', $2::uuid)
on conflict (lane_id, kind) do nothing`,
    parameters: [id, scopeId],
  });
  return { id, written: false };
}
