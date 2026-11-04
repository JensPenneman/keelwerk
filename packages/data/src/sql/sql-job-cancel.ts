import { encodeInstant } from './encode-instant.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** Which pending jobs to cancel: those of a queue with a key, or those with these ids. */
export type SqlJobCancelTarget =
  | { readonly queue: string; readonly key: string }
  | { readonly ids: readonly string[] };

/** A job that was cancelled. */
export interface SqlCancelledJob {
  readonly id: string;
  readonly laneId: string;
  readonly state: string;
  readonly ordering: string;
  readonly key: string | null;
}

/**
 * Takes pending jobs (`scheduled`, `available` or `waiting`) out of the queue and writes their
 * `cancelled` history rows, which never hold the input (9.5.2). A job that was `available` leaves
 * its lane's `enqueued` count at the commit tail, beside the other changes of the unit. A
 * namespace-scope unit cancels across scopes (the maintenance policy of the queue tables); every
 * other unit only its own.
 */
export async function sqlJobCancel(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  target: SqlJobCancelTarget,
): Promise<readonly SqlCancelledJob[]> {
  const root = quoteIdentifier(ctx.namespace.root);
  const parameters: unknown[] = [];
  const bind = (value: unknown, cast: string): string => {
    parameters.push(value);
    return `$${parameters.length}::${cast}`;
  };
  const conditions = [`state in ('scheduled', 'available', 'waiting')`];
  if ('ids' in target) {
    conditions.push(`id = any (${bind(target.ids, 'bigint[]')})`);
  } else {
    conditions.push(`queue = ${bind(target.queue, 'text')}`, `key = ${bind(target.key, 'text')}`);
  }
  if (ctx.scope.level !== 'namespace') {
    conditions.push(`scope_id = ${bind(ctx.scopeId(), 'uuid')}`);
  }
  const finished = bind(encodeInstant(ctx.clock.now()), 'timestamptz');
  const rows = await runSql(ctx.db, {
    sql: `with gone as (
  delete from ${root}.kw_jobs where ${conditions.join(' and ')}
  returning id, scope_id, lane_id, queue, kind, state, attempt, ordering, key
), history as (
  insert into ${root}.kw_job_history (scope_id, job_id, queue, kind, outcome, attempts, started_at, finished_at, error)
  select scope_id, id, queue, kind, 'cancelled', attempt, null, ${finished}, null from gone
)
select id::text as id, lane_id::text as lane_id, state, ordering, key from gone order by id`,
    parameters,
  });
  const cancelled = rows.map((row) => ({
    id: String(row.id),
    laneId: String(row.lane_id),
    state: String(row.state),
    ordering: String(row.ordering),
    key: row.key === null ? null : String(row.key),
  }));
  for (const job of cancelled) {
    if (job.state === 'available') buffer.moveLane(job.laneId, -1);
  }
  return cancelled;
}
