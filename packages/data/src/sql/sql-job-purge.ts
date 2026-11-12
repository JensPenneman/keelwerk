import type { PurgedJob } from '@keelwerk/core';
import { encodeInstant } from './encode-instant.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlJobRelease } from './sql-job-release.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** A job that was purged. */
export interface SqlPurgedJob {
  readonly id: string;
  readonly laneId: string;
  readonly state: string;
  readonly ordering: string;
  readonly key: string | null;
  readonly queue: string;
  readonly run: PurgedJob['run'];
}

/**
 * Erasure (14.7.5, step 5a): deletes the unit's scope's action jobs of `queues` in every state but
 * `running` whose stored principal reference has an id among `principalIds` (a job another principal
 * runs stays, whoever caused it), and writes a `cancelled` history row for each, which never holds
 * the input (a dead job keeps the `dead` row it already has). A job that was `available` leaves its
 * lane's `enqueued` count at the commit tail; the next waiting job of a key whose head left is
 * released. The jobs are answered with what they ran, for the value keys of their secret members.
 */
export async function sqlJobPurge(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  principalIds: readonly string[],
  queues: readonly string[],
): Promise<readonly SqlPurgedJob[]> {
  const root = quoteIdentifier(ctx.namespace.root);
  const finished = encodeInstant(ctx.clock.now());
  const rows = await runSql(ctx.db, {
    sql: `with gone as (
  delete from ${root}.kw_jobs where state <> 'running' and scope_id = $1::uuid
    and kind = 'action' and queue = any ($4::text[]) and principal->>'principalId' = any ($2::text[])
  returning id, scope_id, lane_id, queue, kind, state, attempt, ordering, key, input
), history as (
  insert into ${root}.kw_job_history (scope_id, job_id, queue, kind, outcome, attempts, started_at, finished_at, error)
  select scope_id, id, queue, kind, 'cancelled', attempt, null, $3::timestamptz, null from gone
  on conflict do nothing
)
select id::text as id, lane_id::text as lane_id, queue, state, ordering, key, input from gone order by id`,
    parameters: [ctx.scopeId(), principalIds, finished, queues],
  });
  const purged = rows.map(
    (row): SqlPurgedJob => ({
      id: String(row.id),
      laneId: String(row.lane_id),
      state: String(row.state),
      ordering: String(row.ordering),
      key: row.key === null ? null : String(row.key),
      queue: String(row.queue),
      run: (typeof row.input === 'string' ? JSON.parse(row.input) : row.input) as PurgedJob['run'],
    }),
  );
  for (const job of purged) {
    if (job.state === 'available') buffer.moveLane(job.laneId, -1);
  }
  for (const job of purged) {
    if (job.state !== 'waiting' && job.ordering === 'fifo-per-key' && job.key !== null) {
      await sqlJobRelease(ctx, buffer, job.laneId, job.key);
    }
  }
  return purged;
}
