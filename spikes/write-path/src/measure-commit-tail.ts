import { performance } from 'node:perf_hooks';
import type { ClientConfig } from 'pg';
import { connect } from './connect.ts';
import type { MeasurementResult } from './measurement-result.ts';
import { medianRow } from './median-row.ts';
import type { ResultRow } from './result-row.ts';
import { runAppends } from './run-appends.ts';
import type { RunningPostgres } from './running-postgres.ts';
import { seedLanes } from './seed-lanes.ts';
import { seedScopes } from './seed-scopes.ts';
import type { SeededScope } from './seeded-scope.ts';
import { startDelayProxy } from './start-delay-proxy.ts';
import { summarize } from './summarize.ts';
import { summarizeAppends } from './summarize-appends.ts';

const repetitions = 3;

const roundTrip = async (config: ClientConfig): Promise<number> => {
  const client = await connect(config, 'rtt');
  const latencies: number[] = [];
  for (let index = 0; index < 200; index += 1) {
    const started = performance.now();
    await client.query('select 1');
    latencies.push(performance.now() - started);
  }
  await client.end();
  return summarize(latencies).p50;
};

/**
 * Item (2): appends per second of one scope at 1, 4 and 16 writers, with the commit tail of section
 * 15.1.4 as written (counter update, event insert, COMMIT: three round trips under the counter's
 * lock) and folded into one statement (two round trips), with and without an enqueued job counted at
 * the tail, directly and through a proxy that adds about two milliseconds of round trip.
 */
export async function measureCommitTail(postgres: RunningPostgres): Promise<MeasurementResult> {
  const admin = await connect(postgres.admin, 'seed');
  const scope = (await seedScopes(admin, 200, 1, 64))[0] as SeededScope;
  const [lane] = await seedLanes(admin, {
    queue: 'effects',
    capabilitySet: '',
    lanes: 1,
    jobsPerLane: 0,
    cap: 1000,
    scopes: [scope.id],
  });
  await admin.end();
  const host = postgres.app.host ?? '127.0.0.1';
  const port = postgres.app.port ?? 5432;
  const proxy = await startDelayProxy({ host, port }, 1);
  const proxied: ClientConfig = { ...postgres.app, host: '127.0.0.1', port: proxy.port };
  const paths = [
    { path: 'direct', config: postgres.app, rtt: await roundTrip(postgres.app) },
    { path: 'proxy', config: proxied, rtt: await roundTrip(proxied) },
  ];
  const plan: {
    path: number;
    tail: 'statements' | 'single-statement';
    job: boolean;
    writers: number;
  }[] = [];
  for (const tail of ['statements', 'single-statement'] as const) {
    for (const writers of [1, 4, 16]) plan.push({ path: 0, tail, job: false, writers });
    plan.push({ path: 0, tail, job: true, writers: 16 });
  }
  for (const writers of [1, 4, 16]) plan.push({ path: 1, tail: 'statements', job: false, writers });
  plan.push({ path: 1, tail: 'single-statement', job: false, writers: 16 });
  const runs = plan.map((): ResultRow[] => []);
  try {
    // Every repetition walks the whole plan, so drifting background load spreads over all rows.
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      for (const [index, step] of plan.entries()) {
        const route = paths[step.path];
        if (route === undefined) continue;
        const per = Math.floor(scope.entities.length / step.writers);
        const run = await runAppends({
          app: route.config,
          writers: Array.from({ length: step.writers }, (_, writer) => ({
            scope,
            targets: scope.entities.slice(writer * per, writer * per + per),
            loads: [],
            enqueueLane: step.job ? lane : undefined,
          })),
          unit: {
            isolation: 'read committed',
            positionedLoads: true,
            targetPosition: 'same-statement',
            tail: step.tail,
            notifyInTransaction: false,
            auditTargetPosition: false,
          },
          warmupMs: 300,
          durationMs: 1500,
          seed: 4 + repetition,
        });
        const summary = summarizeAppends(run);
        const hold = Number(summary['tail hold p50 ms']);
        runs[index]?.push({
          path: `${route.path} (rtt ${route.rtt.toFixed(2)} ms)`,
          tail: step.tail,
          'job at tail': step.job ? 'yes' : 'no',
          writers: step.writers,
          ...summary,
          'ceiling 1/hold per s': step.tail === 'statements' ? Math.round(1000 / hold) : 'n/a',
        });
      }
    }
  } finally {
    await proxy.close();
  }
  const rows = runs.map((repeated) => medianRow(repeated, 'commits/s'));
  return {
    id: '2',
    title: 'Single-tenant ceiling of the commit tail',
    sections: '15.1.4 (cost), ADR 0007 item 2 and consequences',
    rows,
    notes: [
      `One scope, every writer on its own entity rows: the counter row is the only shared row. Medians of ${repetitions} runs of 1.5 s, the plan walked once per repetition.`,
      'Tail wait: the counter update (statements) or the whole tail statement (single-statement). Tail hold: counter lock acquired until COMMIT returned; for single-statement only the COMMIT, so it understates the hold by the insert.',
      'Ceiling 1/hold: the rate at which one scope could commit if the counter lock were the only constraint.',
    ],
  };
}
