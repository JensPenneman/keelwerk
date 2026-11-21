import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { DataAdapter, Scope, StoredJob, StoredJobSpec, Unit } from '@keelwerk/core';
import pg from 'pg';
import { describe, expect, onTestFinished, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { jobSpy } from './support/job-spy.ts';
import { jobOf, ownQueue, workerStart } from './support/worker-kit.ts';

const queueName = 'fair';
const cap = 4;
/**
 * The shapes of the case. A flood is `flood` units of A that enqueue `perUnit` jobs each through the
 * store's own path; `openAt` is the flood unit that is open when tenant B enqueues its one job, from
 * its first job until the first take after B's commit has ended: the units before it are committed.
 * The first shape is the criterion's: 20 units of 500 are 10,000 jobs. The second is the smallest
 * flood that shows what the first cannot: with twice the slots of the cap, a pick that ignored the
 * cap would hand out more than `cap` jobs of a lane with more than `cap` committed jobs (the
 * first unit commits `cap + 1`).
 */
const shapes = [
  {
    title:
      "while tenant A enqueues 10,000 jobs, tenant B's job is handed out at the latest by the first take that begins after its commit and no lane exceeds its cap",
    slots: cap,
    perUnit: 500,
    flood: 20,
    openAt: 10,
  },
  {
    title:
      "with twice the slots of the cap, tenant B's job is handed out at the latest by the first take that begins after its commit and no lane exceeds its cap (15 jobs of A)",
    slots: 2 * cap,
    perUnit: cap + 1,
    flood: 3,
    openAt: 2,
  },
];
/**
 * Bounds a hang on the drain. No assertion reads a clock or depends on how many takes a run makes: the
 * case waits on promises and orders events, so its outcome does not depend on how long a step takes.
 */
const hangSeconds = 60;

/** One lane of the queue as a sample sees it. */
interface LaneSample {
  readonly scopeId: string;
  readonly cap: number;
  /** `taken - done`, the load a take computes the lane's room from. */
  readonly counted: number;
  /** The rows of `kw_jobs` in state `running`. */
  readonly running: number;
}

describe('fairness while one tenant enqueues 10,000 jobs', () => {
  test.each(shapes)(
    '$title',
    {
      timeout: 120_000,
    },
    async ({ slots, perUnit, flood, openAt }) => {
      const database = await createTestDatabase(`fairness_${perUnit}_${slots}`);
      const descriptors = new Map(
        [...conformanceApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor]),
      );
      const { spy, factory } = jobSpy(
        (ref) => descriptors.get(ref),
        postgresAdapter({ ownerUrl: database.adminUrl }),
      );
      const gate = Promise.withResolvers<void>();
      const bStarted = Promise.withResolvers<void>();
      const afterB = Promise.withResolvers<void>();
      const held = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const runtime = await startTestRuntime(conformanceApp, {
        tenants: ['acme', 'globex'],
        clock: { now: () => workerStart },
        external: { factory, url: database.appUrl },
      });
      const owner = new pg.Client({ connectionString: database.adminUrl });
      let handle: Awaited<ReturnType<ReturnType<typeof ownQueue>['work']>> | undefined;
      let open: Promise<void> | undefined;
      let left: number | undefined;
      // Registered as soon as the runtime runs, so it runs whatever way the case ends: lets every wait
      // go, drains what the case has not drained, stops the runtime (which ends the adapter's pools and
      // its feed connections), ends the owner client, and waits for the open unit to settle. Ending a
      // client that never connected is a no-op.
      onTestFinished(async () => {
        release.resolve();
        gate.resolve();
        bStarted.resolve();
        afterB.resolve();
        left ??= await handle?.drain(Temporal.Now.instant().add({ seconds: hangSeconds }));
        await runtime.stop();
        await owner.end();
        await open?.catch(() => undefined);
      });
      await owner.connect();
      const root = `"${runtime.namespace.root.replaceAll('"', '""')}"`;
      const tenantA = runtime.tenants.acme.id;
      const tenantB = runtime.tenants.globex.id;
      const scopeOf = (tenantId: string): Scope => ({
        level: 'tenant',
        backendId: runtime.backendId,
        tenantId,
      });
      const isB = (scope: Scope) => scope.level === 'tenant' && scope.tenantId === tenantB;

      // Takes and completions exclude one another: a take holds the lock from its call until its sample
      // is pushed, and a handler holds it around its completion unit. No completion commits between a
      // take's commit and its sample, so a sample shows every lane's cap, `taken - done` and running rows
      // as that take left them (an enqueue that commits in between moves none of them).
      let tail: Promise<void> = Promise.resolve();
      const exclusive = async (): Promise<() => void> => {
        const before = tail;
        const turn = Promise.withResolvers<void>();
        tail = turn.promise;
        await before;
        return turn.resolve;
      };
      const samples: LaneSample[][] = [];
      const firstSample = Promise.withResolvers<void>();
      // The index in the take order of the first take that began after B's enqueue committed, and the
      // promise that settles once that take has ended with its sample pushed (takes and samples share
      // the lock's order, one sample per take).
      let firstAfterB: number | undefined;
      const noteSample = () => {
        if (firstAfterB !== undefined && samples.length > firstAfterB) afterB.resolve();
      };
      const sample = async (): Promise<LaneSample[]> =>
        (
          await owner.query<{ scopeId: string; cap: number; counted: string; running: string }>(
            `select l.scope_id::text as "scopeId", l.cap, (l.taken - d.value)::text as counted,
  (select count(*) from ${root}.kw_jobs j where j.lane_id = l.id and j.state = 'running')::text as running
from ${root}.kw_job_lanes l join ${root}.kw_job_lane_counts d on d.lane_id = l.id and d.kind = 'done'
where l.queue = $1`,
            [queueName],
          )
        ).rows.map((row) => ({
          scopeId: row.scopeId,
          cap: row.cap,
          counted: Number(row.counted),
          running: Number(row.running),
        }));
      const base = runtime.adapter;
      const sampled: DataAdapter = {
        ...base,
        unit: async (namespace, scope, fn, options) => {
          let leave: (() => void) | undefined;
          try {
            const result = await base.unit(
              namespace,
              scope,
              (unit) =>
                fn({
                  ...unit,
                  jobs: {
                    ...unit.jobs,
                    take: async (queue, worker, request) => {
                      leave ??= await exclusive();
                      return unit.jobs.take(queue, worker, request);
                    },
                  },
                }),
              options,
            );
            if (leave) {
              samples.push(await sample());
              firstSample.resolve();
              noteSample();
            }
            return result;
          } finally {
            leave?.();
          }
        },
      };
      const worker = 'w-fair';
      const queue = ownQueue(runtime, { worker, adapter: sampled });

      // A handler holds its slot at the gate, then completes its attempt in a unit of its scope.
      const handler = async (job: { readonly stored: StoredJob }) => {
        const { stored } = job;
        if (isB(stored.scope)) bStarted.resolve();
        await gate.promise;
        const leave = await exclusive();
        try {
          const granted = await runtime.adapter.unit(runtime.namespace, stored.scope, (unit) =>
            unit.jobs.complete(stored.attempt, worker, { kind: 'succeeded' }),
          );
          if (!granted) throw new Error('the store did not grant the completion');
        } finally {
          leave();
        }
      };
      const enqueue = async (unit: Unit, tenantId: string, count: number) => {
        const spec: StoredJobSpec = jobOf(runtime, {
          queue: queueName,
          scope: scopeOf(tenantId) as StoredJobSpec['scope'],
          laneCap: cap,
        });
        for (let n = 0; n < count; n += 1) await unit.jobs.enqueue(spec);
      };
      const inUnit = (tenantId: string, fn: (unit: Unit) => Promise<void>) =>
        runtime.adapter.unit(runtime.namespace, scopeOf(tenantId), fn);

      // Unit 0 commits 500 jobs of A. Unit 1 enqueues one more and stands open: its insert holds the
      // lane row of A, which the first take must still be able to lock.
      await inUnit(tenantA, (unit) => enqueue(unit, tenantA, perUnit));
      open = inUnit(tenantA, async (unit) => {
        await enqueue(unit, tenantA, 1);
        held.resolve();
        await release.promise;
        await enqueue(unit, tenantA, perUnit - 1);
      });
      await Promise.race([held.promise, open]);
      handle = await queue.work(queueName, handler, { slots, capabilitySets: [''], revision: 1 });
      await firstSample.promise;
      release.resolve();
      await open;
      // Unit `openAt` of A (unit 10 of the first shape) enqueues its first job before B's job commits
      // and stands open until the first take that began after that commit has ended: every take that
      // can hand out B's job runs while this unit holds A's lane row.
      for (let unit = 2; unit < flood; unit += 1) {
        if (unit !== openAt) {
          await inUnit(tenantA, (u) => enqueue(u, tenantA, perUnit));
          continue;
        }
        const firstIn = Promise.withResolvers<void>();
        open = inUnit(tenantA, async (u) => {
          await enqueue(u, tenantA, 1);
          firstIn.resolve();
          await afterB.promise;
          await enqueue(u, tenantA, perUnit - 1);
        });
        await Promise.race([firstIn.promise, open]);
        await inUnit(tenantB, (u) => enqueue(u, tenantB, 1));
        firstAfterB = spy.enqueued.find((entry) => isB(entry.job.scope))?.takesStarted;
        noteSample();
        gate.resolve();
        await open;
      }
      await bStarted.promise;

      const takes = spy.takes.filter((take) => take.queue === queueName);
      // The queue's first take ran while unit 1 stood open, and it handed out A's whole cap.
      expect(takes[0]?.jobs.length).toBe(cap);
      expect(samples[0]).toEqual([{ scopeId: tenantA, cap, counted: cap, running: cap }]);
      // No take of the queue began between B's commit and the take that handed out B's job.
      const committed = spy.enqueued.find((entry) => isB(entry.job.scope));
      const answered = spy.takes.findIndex((take) => take.jobs.some((job) => isB(job.scope)));
      expect(committed).toBeDefined();
      expect(answered).toBeGreaterThanOrEqual(0);
      expect(
        spy.takes
          .slice(committed?.takesStarted, answered)
          .filter((take) => take.queue === queueName),
      ).toEqual([]);

      // The drain left no attempt running at its deadline.
      release.resolve();
      gate.resolve();
      left = await handle.drain(Temporal.Now.instant().add({ seconds: hangSeconds }));
      expect(left).toBe(0);
      // In every sample, every lane has the cap the case enqueued with, and no lane has more rows
      // running, or more taken and not done, than that cap.
      const lanes = samples.flat();
      expect(lanes.length).toBeGreaterThan(0);
      expect(
        lanes.filter((lane) => lane.cap !== cap || lane.running > cap || lane.counted > cap),
      ).toEqual([]);
    },
  );
});
