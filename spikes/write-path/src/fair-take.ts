import { performance } from 'node:perf_hooks';
import type { Client } from 'pg';
import { namespaceRoot as ns } from './namespace-root.ts';
import type { TakeRequest } from './take-request.ts';
import type { TakenJob } from './taken-job.ts';

// `$vmin`, the least virtual time of busy lanes; section 9.5.3 passes it in without saying where it
// comes from, so this reads it in the take's unit, counting a lane as busy while it has work to take.
const vmin = `
  select coalesce(min(l.vtime), 0) as vmin from ${ns}.kw_job_lanes l
  join ${ns}.kw_job_lane_counts e on e.lane_id = l.id and e.kind = 'enqueued'
  where l.queue = $1 and l.capability_set = any ($2) and e.value > l.taken`;

// Section 9.5.3 as written; only the select list names the columns the caller needs.
const take = `
  with picked as (
    select l.id, l.cap - (l.taken - d.value) as room from ${ns}.kw_job_lanes l
    join ${ns}.kw_job_lane_counts e on e.lane_id = l.id and e.kind = 'enqueued'
    join ${ns}.kw_job_lane_counts d on d.lane_id = l.id and d.kind = 'done'
    where l.queue = $1 and l.capability_set = any ($2) and e.value > l.taken and l.taken - d.value < l.cap
    order by l.priority, (l.taken - d.value) / l.weight, greatest(l.vtime, $3)
    limit $4
    for update of l skip locked
  ), share as (select greatest(1, ceil($5::numeric / nullif(count(*), 0))) as n from picked)
  select j.id::text as id, j.lane_id::text as "laneId", j.scope_id as "scopeId", j.cost, j.attempt
  from picked p cross join share s cross join lateral (
    select * from ${ns}.kw_jobs j
    where j.lane_id = p.id and j.state = 'available' and j.revision <= $6
      and not exists (select 1 from ${ns}.kw_job_groups g where g.id = j.group_id and g.blocked_until > now())
    order by j.run_at, j.id
    limit least(p.room, s.n)
    for update skip locked) j`;

const running = `
  update ${ns}.kw_jobs set state = 'running', worker = $1, attempt = attempt + 1,
    lease_until = now() + $2 * interval '1 millisecond'
  where id = any ($3::bigint[])`;

const lanes = `
  update ${ns}.kw_job_lanes l set taken = l.taken + x.n, vtime = greatest(l.vtime, $1) + x.cost::double precision / l.weight
  from (select unnest($2::bigint[]) as lane, unnest($3::bigint[]) as n, unnest($4::bigint[]) as cost) x
  where l.id = x.lane`;

/**
 * One take in a namespace-scope unit: `$vmin`, the take statement, the jobs to `running` with
 * (worker, attempt, lease), and `taken` and the virtual time on the lanes, then COMMIT. Groups are
 * not exercised (no job has one), and expired leases are not reclaimed first.
 */
export async function fairTake(
  client: Client,
  request: TakeRequest,
): Promise<{ readonly jobs: readonly TakenJob[]; readonly statementMs: number }> {
  await client.query('begin isolation level read committed');
  try {
    await client.query(`select set_config('keelwerk.scope', 'namespace', true)`);
    const sets = [...request.capabilitySets];
    const least = Number(
      (await client.query<{ vmin: number }>(vmin, [request.queue, sets])).rows[0]?.vmin ?? 0,
    );
    const started = performance.now();
    const picked = await client.query<Omit<TakenJob, 'attempt'> & { attempt: number }>(take, [
      request.queue,
      sets,
      least,
      request.lanes,
      request.batch,
      request.maxRevision,
    ]);
    const statementMs = performance.now() - started;
    const jobs = picked.rows.map((job) => ({ ...job, attempt: job.attempt + 1 }));
    if (jobs.length > 0) {
      await client.query(running, [request.worker, request.leaseMs, jobs.map((job) => job.id)]);
      const perLane = new Map<string, { n: number; cost: number }>();
      for (const job of jobs) {
        const lane = perLane.get(job.laneId) ?? { n: 0, cost: 0 };
        lane.n += 1;
        lane.cost += job.cost;
        perLane.set(job.laneId, lane);
      }
      await client.query(lanes, [
        least,
        [...perLane.keys()],
        [...perLane.values()].map((lane) => lane.n),
        [...perLane.values()].map((lane) => lane.cost),
      ]);
    }
    await client.query('commit');
    return { jobs, statementMs };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}
