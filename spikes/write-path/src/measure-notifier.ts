import { performance } from 'node:perf_hooks';
import { CoalescingNotifier } from './coalescing-notifier.ts';
import { connect } from './connect.ts';
import type { MeasurementResult } from './measurement-result.ts';
import { medianRow } from './median-row.ts';
import { namespaceRoot as ns } from './namespace-root.ts';
import type { ResultRow } from './result-row.ts';
import { runAppends } from './run-appends.ts';
import type { RunningPostgres } from './running-postgres.ts';
import { seedScopes } from './seed-scopes.ts';
import type { SeededScope } from './seeded-scope.ts';
import { summarize } from './summarize.ts';
import { summarizeAppends } from './summarize-appends.ts';
import type { WriterAssignment } from './writer-assignment.ts';

const channel = 'kw_events';
const durationMs = 2000;
const repetitions = 3;

/**
 * Item (3): writers of eight tenants (two each) with no wake-ups, with the coalescing notifier of
 * section 14.3.7 (afterCommit hook, one NOTIFY per namespace every 50 ms from its own connection,
 * a LISTEN connection receiving), and with the rejected NOTIFY inside each writer's transaction.
 * Wake-up latency runs from a unit's COMMIT returning to the LISTEN connection receiving the
 * notification that names its scope.
 */
export async function measureNotifier(postgres: RunningPostgres): Promise<MeasurementResult> {
  const admin = await connect(postgres.admin, 'seed');
  const scopes = await seedScopes(admin, 300, 8, 16);
  await admin.end();
  const writers: WriterAssignment[] = Array.from({ length: 16 }, (_, writer) => {
    const scope = scopes[writer % 8] as SeededScope;
    const slot = Math.floor(writer / 8);
    return { scope, targets: scope.entities.slice(slot * 8, slot * 8 + 8), loads: [] };
  });
  const base = {
    isolation: 'read committed',
    positionedLoads: true,
    targetPosition: 'same-statement',
    tail: 'statements',
    auditTargetPosition: false,
  } as const;
  const run = (
    notifyInTransaction: boolean,
    seed: number,
    afterCommit?: (scope: SeededScope, at: number) => void,
  ) =>
    runAppends({
      app: postgres.app,
      writers,
      unit: { ...base, notifyInTransaction },
      warmupMs: 300,
      durationMs,
      seed,
      afterCommit: afterCommit && ((scope, timing) => afterCommit(scope, timing.committedAt)),
    });

  const coalescing = async (seed: number): Promise<ResultRow> => {
    const sender = await connect(postgres.app, 'notifier');
    const listener = await connect(postgres.app, 'listener');
    const unwoken = new Map<string, number[]>();
    const inFlight: number[][] = [];
    const wakeLatencies: number[] = [];
    listener.on('notification', () => {
      const received = performance.now();
      for (const committedAt of inFlight.shift() ?? []) wakeLatencies.push(received - committedAt);
    });
    await listener.query(`listen ${channel}`);
    const notifier = new CoalescingNotifier(
      async (payload) => {
        const listed = payload.slice(payload.indexOf(':') + 1);
        const covered = listed === '*' ? [...unwoken.keys()] : listed.split(',');
        inFlight.push(covered.flatMap((scope) => unwoken.get(scope) ?? []));
        for (const scope of covered) unwoken.delete(scope);
        await sender.query('select pg_notify($1, $2)', [channel, payload]);
      },
      { intervalMs: 50, maxPayloadBytes: 7999 },
    );
    notifier.start();
    const result = await run(false, seed, (scope, committedAt) => {
      unwoken.set(scope.id, [...(unwoken.get(scope.id) ?? []), committedAt]);
      notifier.committed(ns, scope.id);
    });
    await notifier.stop();
    // A round trip on the listener delivers notifications the server sent before its reply.
    await listener.query('select 1');
    await sender.end();
    await listener.end();
    const wake = summarize(wakeLatencies);
    const { notifications, scopes: named } = notifier.stats;
    return {
      mode: 'coalescing notifier (50 ms)',
      ...summarizeAppends(result),
      'notifications/s': Math.round((notifications * 1000) / (durationMs + 300)),
      'scopes/notification': Number((named / Math.max(1, notifications)).toFixed(2)),
      'wake p50 ms': Number(wake.p50.toFixed(1)),
      'wake p95 ms': Number(wake.p95.toFixed(1)),
      'wake max ms': Number(wake.max.toFixed(1)),
      'commits not woken': [...unwoken.values()].reduce((total, list) => total + list.length, 0),
    };
  };

  const modes: readonly ((seed: number) => Promise<ResultRow>)[] = [
    async (seed) => ({ mode: 'no wake-ups', ...summarizeAppends(await run(false, seed)) }),
    coalescing,
    async (seed) => ({
      mode: 'NOTIFY inside the writer (rejected)',
      ...summarizeAppends(await run(true, seed)),
    }),
  ];
  const runs = modes.map((): ResultRow[] => []);
  // The modes alternate within each repetition, so drifting background load hits all of them alike.
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const [index, mode] of modes.entries()) runs[index]?.push(await mode(5 + repetition));
  }
  const rows = runs.map((repeated) => medianRow(repeated, 'commits/s'));
  return {
    id: '3',
    title: 'The notifier: wake-ups outside writer transactions',
    sections: '14.3.7, 15.2.5, ADR 0007 item 11',
    rows,
    notes: [
      `Eight tenants, two writers each, closed loop, one event per unit; medians of ${repetitions} alternating runs of ${durationMs} ms per mode.`,
      'Wake latency counts every commit (not every notification), so a commit just after a flush waits up to one interval.',
    ],
  };
}
