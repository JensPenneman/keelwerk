import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import type { Client } from 'pg';
import { completeJobs } from './complete-jobs.ts';
import { connect } from './connect.ts';
import { fairTake } from './fair-take.ts';
import type { MeasurementResult } from './measurement-result.ts';
import { medianRow } from './median-row.ts';
import { namespaceRoot as ns } from './namespace-root.ts';
import type { ResultRow } from './result-row.ts';
import { runLoad } from './run-load.ts';
import type { RunningPostgres } from './running-postgres.ts';
import { seedLanes } from './seed-lanes.ts';
import { summarize } from './summarize.ts';
import type { TakeSample } from './take-sample.ts';

const takers = 4;
const repetitions = 3;
const capability = 'default';
const two = (value: number): number => Number(value.toFixed(2));

const takeLoop = async (
  clients: readonly Client[],
  queue: string,
  batch: number,
  holdMs: number,
  onTaken?: (jobs: readonly { readonly laneId: string }[], delta: 1 | -1) => void,
) =>
  runLoad<TakeSample>({
    workers: clients.length,
    warmupMs: 300,
    durationMs: 1500,
    step: async (worker) => {
      const client = clients[worker] as Client;
      const name = `t${worker}`;
      const started = performance.now();
      const taken = await fairTake(client, {
        queue,
        worker: name,
        capabilitySets: [capability],
        batch,
        lanes: batch,
        maxRevision: 1,
        leaseMs: 30_000,
      });
      const takeMs = performance.now() - started;
      onTaken?.(taken.jobs, 1);
      if (holdMs > 0) await delay(holdMs);
      onTaken?.(taken.jobs, -1);
      const completed = await completeJobs(client, name, taken.jobs, queue);
      return { takeMs, statementMs: taken.statementMs, jobs: taken.jobs.length, completed };
    },
  });

const capCheck = async (
  admin: Client,
  clients: readonly Client[],
  lanes: number,
): Promise<ResultRow> => {
  const cap = 3;
  const queue = `caps-${lanes}`;
  await seedLanes(admin, { queue, capabilitySet: capability, lanes, jobsPerLane: 200, cap });
  const inProcess = new Map<string, number>();
  let inProcessMax = 0;
  let dbMax = 0;
  let overCap = 0;
  let samples = 0;
  let sampling = true;
  const sampler = (async (): Promise<void> => {
    while (sampling) {
      const counts = await admin.query<{ n: number }>(
        `select count(*)::int as n from ${ns}.kw_jobs where queue = $1 and state = 'running' group by lane_id`,
        [queue],
      );
      samples += 1;
      for (const row of counts.rows) {
        dbMax = Math.max(dbMax, row.n);
        if (row.n > cap) overCap += 1;
      }
      await delay(2);
    }
  })();
  const run = await takeLoop(clients, queue, 10, 2, (jobs, delta) => {
    for (const job of jobs) {
      const next = (inProcess.get(job.laneId) ?? 0) + delta;
      inProcess.set(job.laneId, next);
      inProcessMax = Math.max(inProcessMax, next);
    }
  });
  sampling = false;
  await sampler;
  const drift = await admin.query<{ n: number }>(
    `select count(*)::int as n from ${ns}.kw_job_lanes l
     join ${ns}.kw_job_lane_counts d on d.lane_id = l.id and d.kind = 'done'
     where l.queue = $1
       and l.taken - d.value <> (select count(*) from ${ns}.kw_jobs j where j.lane_id = l.id and j.state = 'running')`,
    [queue],
  );
  const jobs = run.samples.reduce((total, sample) => total + sample.jobs, 0);
  const take = summarize(run.samples.map((sample) => sample.takeMs));
  return {
    lanes,
    batch: 10,
    takers: clients.length,
    'take p50 ms': two(take.p50),
    'take p95 ms': two(take.p95),
    'jobs/s': Math.round((jobs * 1000) / run.windowMs),
    cap,
    'max running per lane (db samples)': dbMax,
    'db samples over cap': `${overCap} of ${samples}`,
    'max running per lane (takers)': inProcessMax,
    'lanes with taken-done != running': drift.rows[0]?.n ?? -1,
  };
};

/**
 * Item (4): the take's latency against the number of lanes (1, 10, 100, 1000; one tenant per lane)
 * and the batch size (1, 10, 50) with four takers that complete each batch at once and enqueue a
 * replacement per job, so the backlog stays level; then lane caps under eight concurrent takers
 * that hold their jobs for 2 ms (sections 9.5.3, 9.5.5, 14.3.9, 26.2 item 7).
 */
export async function measureFairTake(postgres: RunningPostgres): Promise<MeasurementResult> {
  const admin = await connect(postgres.admin, 'seed');
  const rows: ResultRow[] = [];
  const clients = await Promise.all(
    Array.from({ length: 8 }, (_, index) => connect(postgres.app, `t:${index}`)),
  );
  try {
    const grid = [1, 10, 100, 1000].flatMap((lanes) =>
      [1, 10, 50].map((batch) => ({ lanes, batch, queue: `take-${lanes}-${batch}` })),
    );
    for (const { lanes, queue } of grid) {
      await seedLanes(admin, {
        queue,
        capabilitySet: capability,
        lanes,
        jobsPerLane: Math.max(10, Math.ceil(2000 / lanes)),
        cap: 1000,
      });
    }
    const runs = grid.map((): ResultRow[] => []);
    // Every repetition walks the whole grid, so drifting background load spreads over all rows.
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      for (const [index, { lanes, batch, queue }] of grid.entries()) {
        const run = await takeLoop(clients.slice(0, takers), queue, batch, 0);
        const take = summarize(run.samples.map((sample) => sample.takeMs));
        const statement = summarize(run.samples.map((sample) => sample.statementMs));
        const jobs = run.samples.reduce((total, sample) => total + sample.jobs, 0);
        const empty = run.samples.filter((sample) => sample.jobs === 0).length;
        runs[index]?.push({
          lanes,
          batch,
          takers,
          'take p50 ms': two(take.p50),
          'take p95 ms': two(take.p95),
          'take p99 ms': two(take.p99),
          'statement p95 ms': two(statement.p95),
          'takes/s': Math.round((run.samples.length * 1000) / run.windowMs),
          'jobs/s': Math.round((jobs * 1000) / run.windowMs),
          'empty takes %': two((empty * 100) / Math.max(1, run.samples.length)),
          'jobs/take': two(jobs / Math.max(1, run.samples.length)),
        });
      }
    }
    for (const [index, { queue }] of grid.entries()) {
      const spread = await admin.query<{ low: string; high: string }>(
        `select min(taken)::text as low, max(taken)::text as high from ${ns}.kw_job_lanes where queue = $1`,
        [queue],
      );
      rows.push({
        ...medianRow(runs[index] ?? [], 'jobs/s'),
        'taken per lane min-max': `${spread.rows[0]?.low}-${spread.rows[0]?.high}`,
      });
    }

    // Lane caps: lanes capped at 3 running jobs, 8 takers asking for 10 jobs each, jobs held 2 ms.
    for (const lanes of [10, 1]) rows.push(await capCheck(admin, clients, lanes));
  } finally {
    await Promise.all(clients.map((client) => client.end()));
    await admin.end();
  }
  return {
    id: '4',
    title: 'The fair take',
    sections: '9.5.2, 9.5.3, 9.5.5, 14.3.9, 26.2 item 7',
    rows,
    notes: [
      'Take: the namespace-scope unit (set_config, $vmin read, take statement, jobs to running, lanes taken and vtime, COMMIT); statement: the take statement alone.',
      `\`$lanes\` is set to the batch size; cap 1000 (not binding) in the grid; medians of ${repetitions} runs of 1.5 s, the grid walked once per repetition. jobs/s counts jobs taken and completed (one completion unit per batch, with a replacement job).`,
      'Cap rows: db samples count running jobs per lane on a separate connection every ~2 ms; takers count from take commit until just before the completion unit, a lower bound of the true count.',
    ],
  };
}
