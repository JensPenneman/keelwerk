import { setTimeout as delay } from 'node:timers/promises';
import { connect } from './connect.ts';
import type { MeasurementResult } from './measurement-result.ts';
import { medianRow } from './median-row.ts';
import { namespaceRoot as ns } from './namespace-root.ts';
import type { ResultRow } from './result-row.ts';
import { runAppends } from './run-appends.ts';
import type { RunningPostgres } from './running-postgres.ts';
import { seedScopes } from './seed-scopes.ts';
import type { SeededScope } from './seeded-scope.ts';
import { startWaitSampler } from './start-wait-sampler.ts';
import { summarize } from './summarize.ts';
import { summarizeAppends } from './summarize-appends.ts';
import type { WaitCounts } from './wait-counts.ts';
import type { WriterAssignment } from './writer-assignment.ts';

const unit = {
  isolation: 'read committed',
  positionedLoads: true,
  targetPosition: 'same-statement',
  tail: 'statements',
  notifyInTransaction: false,
  auditTargetPosition: false,
} as const;
const writers = 16;
const durationMs = 1500;
const repetitions = 3;
const warmupMs = 500;
const holdMs = 1500;

// Writers spread round-robin over the scopes; each cycles through its own targets, so no two writers
// share an entity row and the only shared rows are the scopes' counters.
const assign = (scopes: readonly SeededScope[]): WriterAssignment[] =>
  Array.from({ length: writers }, (_, writer) => {
    const scope = scopes[writer % scopes.length] as SeededScope;
    const slot = Math.floor(writer / scopes.length);
    const per = Math.floor(scope.entities.length / Math.ceil(writers / scopes.length));
    return { scope, targets: scope.entities.slice(slot * per, slot * per + per), loads: [] };
  });

const waits = (counts: WaitCounts): ResultRow => ({
  'lock waits same scope': counts.sameScope,
  'lock waits cross scope': counts.crossScope,
});

/**
 * Item (1): the same load in one tenant and spread over eight. Closed loop for throughput, paced at
 * half the one-tenant throughput for latency at equal offered load, and a probe that holds one
 * tenant's counter row for 1.5 s while the other seven keep writing (sections 15.1.4, ADR 0007 item 2).
 */
export async function measureTenantIsolation(
  postgres: RunningPostgres,
): Promise<MeasurementResult> {
  const admin = await connect(postgres.admin, 'seed');
  const one = await seedScopes(admin, 100, 1, 64);
  const eight = await seedScopes(admin, 110, 8, 16);
  const probe = await seedScopes(admin, 120, 8, 16);
  await admin.end();
  const rows: ResultRow[] = [];
  const crossScope = { closed: 0, probe: 0 };
  const closedRuns = new Map<number, ResultRow[]>([
    [1, []],
    [8, []],
  ]);
  const pacedRuns = new Map<number, ResultRow[]>([
    [1, []],
    [8, []],
  ]);
  // Configurations alternate within each repetition, so drifting background load hits both alike.
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const scopes of [one, eight]) {
      const sampler = await startWaitSampler(postgres.admin, 10);
      const run = await runAppends({
        app: postgres.app,
        writers: assign(scopes),
        unit,
        warmupMs,
        durationMs,
        seed: 1 + repetition,
      });
      const counts = await sampler.stop();
      crossScope.closed += counts.crossScope;
      closedRuns.get(scopes.length)?.push({
        run: 'closed loop',
        tenants: scopes.length,
        writers,
        ...summarizeAppends(run),
        ...waits(counts),
      });
    }
  }
  const throughput = (tenants: number): number =>
    Number(medianRow(closedRuns.get(tenants) ?? [])['commits/s']);
  const oneTenant = throughput(1);
  const eightTenants = throughput(8);
  const rate = Math.max(1, Math.round(oneTenant / 2));
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const scopes of [one, eight]) {
      const run = await runAppends({
        app: postgres.app,
        writers: assign(scopes),
        unit,
        warmupMs,
        durationMs,
        ratePerWorker: rate / writers,
        seed: 10 + repetition,
      });
      pacedRuns.get(scopes.length)?.push({
        run: `paced ${rate}/s`,
        tenants: scopes.length,
        writers,
        ...summarizeAppends(run),
      });
    }
  }
  for (const runs of [...closedRuns.values(), ...pacedRuns.values()]) {
    rows.push(medianRow(runs, 'commits/s'));
  }

  // The probe: one connection holds the first probe tenant's counter row (a commit tail that does not
  // end) while one writer of that tenant and two writers of each other tenant run.
  const held = probe[0] as SeededScope;
  const others = probe.slice(1);
  const blocker = await connect(postgres.app, `w:${held.index}:blocker`);
  await blocker.query('begin');
  await blocker.query(`select set_config('keelwerk.tenant_id', $1, true)`, [held.id]);
  await blocker.query(`update ${ns}.kw_positions set next = next where scope_id = $1`, [held.id]);
  const release = delay(holdMs).then(() => blocker.query('commit'));
  const sampler = await startWaitSampler(postgres.admin, 10);
  const probeWriters: WriterAssignment[] = [
    { scope: held, targets: held.entities.slice(0, 8), loads: [] },
    ...assign(others).slice(0, others.length * 2),
  ];
  const run = await runAppends({
    app: postgres.app,
    writers: probeWriters,
    unit,
    warmupMs: 0,
    durationMs: 2000,
    seed: 3,
  });
  await release;
  await blocker.end();
  const counts = await sampler.stop();
  crossScope.probe = counts.crossScope;
  const heldLatencies = run.latencies.filter((_, index) => run.workers[index] === 0);
  const otherLatencies = summarize(run.latencies.filter((_, index) => run.workers[index] !== 0));
  rows.push({
    run: `probe: tenant 1 tail held ${holdMs} ms`,
    tenants: probe.length,
    writers: probeWriters.length,
    'commits/s': Math.round(((run.latencies.length - heldLatencies.length) * 1000) / 2000),
    'p50 ms': Number(otherLatencies.p50.toFixed(2)),
    'p95 ms': Number(otherLatencies.p95.toFixed(2)),
    'p99 ms': Number(otherLatencies.p99.toFixed(2)),
    'held tenant max ms': Number(summarize(heldLatencies).max.toFixed(1)),
    'other tenants max ms': Number(otherLatencies.max.toFixed(2)),
    ...waits(counts),
  });
  return {
    id: '1',
    title: 'Concurrent writers in many tenants',
    sections: '15.1.4, 9.4, ADR 0007 item 2, 26.2 item 6',
    rows,
    notes: [
      `Closed loop, ${writers} writers: 8 tenants commit ${(eightTenants / oneTenant).toFixed(2)}x the units per second of 1 tenant (medians of ${repetitions} alternating runs of ${durationMs} ms).`,
      `Lock waits on another scope's backend: ${crossScope.closed} in all closed-loop samples, ${crossScope.probe} in the probe.`,
      'Lock waits are pg_stat_activity samples every 10 ms of writer backends waiting on a heavyweight lock, classified by the scope of the blocking backends (pg_blocking_pids).',
      'Probe row: latencies of the seven unblocked tenants; their commits/s is for 14 writers.',
    ],
  };
}
