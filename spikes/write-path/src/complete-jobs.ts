import type { Client } from 'pg';
import { namespaceRoot as ns } from './namespace-root.ts';
import type { TakenJob } from './taken-job.ts';

const finish = `
  with done as (
    delete from ${ns}.kw_jobs j using unnest($2::bigint[], $3::integer[]) as f (id, attempt)
    where j.id = f.id and j.attempt = f.attempt and j.worker = $1 and j.state = 'running'
    returning j.id, j.scope_id, j.queue, j.attempt
  )
  insert into ${ns}.kw_job_history (job_id, scope_id, queue, outcome, attempts)
  select id, scope_id, queue, 'succeeded', attempt from done`;

// Counter rows are locked in (lane, kind) order first, so completers touching the same lanes cannot deadlock.
const lockCounts = `
  select 1 from ${ns}.kw_job_lane_counts where lane_id = any ($1::bigint[]) and kind = any ($2::text[])
  order by lane_id, kind for update`;

const count = `
  update ${ns}.kw_job_lane_counts c set value = c.value + x.n
  from (select unnest($1::bigint[]) as lane, unnest($2::bigint[]) as n) x
  where c.lane_id = x.lane and c.kind = $3`;

const replace = `
  insert into ${ns}.kw_jobs (scope_id, lane_id, queue, state, revision, input)
  select scope, lane, $1, 'available', 1, '{}'::jsonb from unnest($2::uuid[], $3::bigint[]) as r (scope, lane)`;

/**
 * Completes taken jobs in one namespace-scope unit: rows removed conditionally on (worker, attempt),
 * history written, each lane's `done` counter moved. With `replace`, one new available job per
 * completed job is enqueued in the same lane (its `enqueued` counter moved), so the backlog stays
 * constant during a measurement. Returns how many completions still held their lease.
 */
export async function completeJobs(
  client: Client,
  worker: string,
  jobs: readonly TakenJob[],
  replaceQueue: string | undefined,
): Promise<number> {
  if (jobs.length === 0) return 0;
  await client.query('begin isolation level read committed');
  try {
    await client.query(`select set_config('keelwerk.scope', 'namespace', true)`);
    const finished = await client.query(finish, [
      worker,
      jobs.map((job) => job.id),
      jobs.map((job) => job.attempt),
    ]);
    const perLane = new Map<string, number>();
    for (const job of jobs) perLane.set(job.laneId, (perLane.get(job.laneId) ?? 0) + 1);
    const laneIds = [...perLane.keys()];
    const kinds = replaceQueue === undefined ? ['done'] : ['done', 'enqueued'];
    await client.query(lockCounts, [laneIds, kinds]);
    await client.query(count, [laneIds, [...perLane.values()], 'done']);
    if (replaceQueue !== undefined) {
      await client.query(replace, [
        replaceQueue,
        jobs.map((job) => job.scopeId),
        jobs.map((job) => job.laneId),
      ]);
      await client.query(count, [laneIds, [...perLane.values()], 'enqueued']);
    }
    await client.query('commit');
    return finished.rowCount ?? 0;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}
