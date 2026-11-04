// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { StoredJob } from '@keelwerk/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { finishJob } from './support/finish-job.ts';
import { instantMs } from './support/instant-ms.ts';
import { succeeded, unavailable } from './support/job-fixtures.ts';
import { jobSpec } from './support/job-spec.ts';
import { laneCount } from './support/lane-count.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { ownerRows } from './support/owner-rows.ts';
import { restartJobIds } from './support/restart-job-ids.ts';
import { stamp } from './support/stamp.ts';
import { storeSuite } from './support/store-suite.ts';
import { takeJobs } from './support/take-jobs.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const store = storeSuite();
const ms = instantMs;
const take = async (
  worker: string,
  request: { limit?: number; lanes?: number; leaseMs?: number } = {},
) => takeJobs(store, worker, request);
const finish = async (...args: [StoredJob, string, Parameters<typeof finishJob>[3]]) =>
  finishJob(store, ...args);
const countOf = async (kind: string) => laneCount(store, kind);
const rows = async (sql: string): Promise<readonly Record<string, unknown>[]> =>
  ownerRows(store.adapter, sql);

beforeEach(async () => {
  await restartJobIds(store.adapter);
});

describe('completion, history and retries', () => {
  test('success removes the job and writes history without input; the done counter moves at the commit', async () => {
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec({ cost: 1 })));
    const [job] = await take('w1');
    store.clock.advance(2000);
    expect(await finish(job as StoredJob, 'w1', succeeded)).toBe(true);
    expect(await rows('select id from app.kw_jobs')).toEqual([]);
    const history = await rows(
      'select job_id::int as job_id, queue, kind, outcome, attempts, started_at, finished_at, error from app.kw_job_history',
    );
    expect(history).toMatchObject([
      {
        job_id: 1,
        queue: 'commands',
        kind: 'action',
        outcome: 'succeeded',
        attempts: 1,
        error: null,
      },
    ]);
    expect(ms(history[0]?.finished_at) - ms(history[0]?.started_at)).toBe(2000);
    expect(Object.keys(history[0] ?? {})).not.toContain('input');
    expect(await countOf('done')).toEqual([1]);
  });

  test('a completion that rolls back with its unit changes nothing', async () => {
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec()));
    const [job] = await take('w1');
    await store
      .run(namespaceScope, async (unit) => {
        expect(await unit.jobs.complete((job as StoredJob).attempt, 'w1', succeeded)).toBe(true);
        throw new Error('undo');
      })
      .catch(() => undefined);
    expect(await rows('select state from app.kw_jobs')).toEqual([{ state: 'running' }]);
    expect(await countOf('done')).toEqual([0]);
    expect(await rows('select * from app.kw_job_history')).toEqual([]);
  });

  test('a completion in the tenant unit of the job works; a unit of another tenant finds no lease', async () => {
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec()));
    const [job] = await take('w1');
    expect(
      await store.run(tenantTwo, (unit) =>
        unit.jobs.complete((job as StoredJob).attempt, 'w1', succeeded),
      ),
    ).toBe(false);
    expect(
      await store.run(tenantScope, (unit) =>
        unit.jobs.complete((job as StoredJob).attempt, 'w1', succeeded),
      ),
    ).toBe(true);
    expect(await countOf('done')).toEqual([1]);
  });

  test('retry reschedules at the given time, clears the worker and keeps the attempt count', async () => {
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec()));
    const [job] = await take('w1');
    const at = stamp.add({ seconds: 30 });
    expect(await finish(job as StoredJob, 'w1', { kind: 'retry', at, error: unavailable })).toBe(
      true,
    );
    expect(
      await rows('select state, worker, lease_until, attempt, lost_leases from app.kw_jobs'),
    ).toEqual([
      { state: 'scheduled', worker: null, lease_until: null, attempt: 1, lost_leases: 0 },
    ]);
    expect(await rows('select * from app.kw_job_history')).toEqual([]);
    store.clock.advance(31_000);
    expect(await store.run(namespaceScope, (unit) => unit.jobs.promote('commands', 5))).toBe(1);
    const [again] = await take('w2');
    expect(again?.attempt).toEqual({ jobId: '1', attempt: 2 });
  });

  test('a dead letter keeps its input, writes history with the error, and a failure leaves only history', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ run: { action: 'a', input: { secret: 1 } } }));
      await unit.jobs.enqueue(jobSpec());
    });
    const [one, two] = await take('w1');
    expect(await finish(one as StoredJob, 'w1', { kind: 'dead', error: unavailable })).toBe(true);
    expect(await finish(two as StoredJob, 'w1', { kind: 'failed', error: unavailable })).toBe(true);
    expect(await rows('select id::int as id, state, input from app.kw_jobs')).toEqual([
      { id: 1, state: 'dead', input: { action: 'a', input: { secret: 1 } } },
    ]);
    expect(
      await rows(
        'select job_id::int as job_id, outcome, error from app.kw_job_history order by job_id',
      ),
    ).toEqual([
      { job_id: 1, outcome: 'dead', error: unavailable },
      { job_id: 2, outcome: 'failed', error: unavailable },
    ]);
  });

  test('FIFO per key releases the next job when the head ends, but not when it retries', async () => {
    const fifo = (): ReturnType<typeof jobSpec> =>
      jobSpec({ ordering: 'fifo-per-key', key: { value: 'q', onConflict: 'keep' } });
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(fifo()));
    const [head] = await take('w1');
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(fifo()));
    expect(await take('w2')).toEqual([]);
    const at = stamp.add({ seconds: 5 });
    await finish(head as StoredJob, 'w1', { kind: 'retry', at, error: unavailable });
    expect(await rows('select id::int as id, state from app.kw_jobs order by id')).toEqual([
      { id: 1, state: 'scheduled' },
      { id: 2, state: 'waiting' },
    ]);
    store.clock.advance(6000);
    await store.run(namespaceScope, (unit) => unit.jobs.promote('commands', 5));
    const [second] = await take('w1');
    await finish(second as StoredJob, 'w1', succeeded);
    expect(await rows('select id::int as id, state from app.kw_jobs order by id')).toEqual([
      { id: 2, state: 'available' },
    ]);
    expect(await countOf('enqueued')).toEqual([3]);
  });
});

describe('leases and heartbeats', () => {
  test('a heartbeat renews only the attempts the worker holds, in one statement', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec());
      await unit.jobs.enqueue(jobSpec());
    });
    const [one, two] = await take('w1', { leaseMs: 1000 });
    store.clock.advance(500);
    const held = await store.run(namespaceScope, (unit) =>
      unit.jobs.heartbeat(
        [
          (one as StoredJob).attempt,
          { jobId: (two as StoredJob).id, attempt: 9 },
          { jobId: 'x', attempt: 1 },
        ],
        'w1',
        4000,
      ),
    );
    expect(held).toEqual([(one as StoredJob).attempt]);
    const leases = await rows('select lease_until from app.kw_jobs order by id');
    expect(leases.map((row) => ms(row.lease_until) - stamp.epochMilliseconds)).toEqual([
      4500, 1000,
    ]);
  });

  test('an expired lease returns the job at the next take; three losses in a row make a dead letter', async () => {
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec()));
    const first = await take('w1', { leaseMs: 1000 });
    store.clock.advance(1500);
    const second = await take('w2', { leaseMs: 1000 });
    expect(second[0]?.attempt).toEqual({ jobId: first[0]?.id, attempt: 2 });
    expect(await finish(first[0] as StoredJob, 'w1', succeeded)).toBe(false);
    expect(await rows('select taken::int as taken from app.kw_job_lanes')).toEqual([{ taken: 1 }]);
    store.clock.advance(1500);
    const third = await take('w3', { leaseMs: 1000 });
    expect(third[0]?.attempt.attempt).toBe(3);
    store.clock.advance(1500);
    expect(await take('w4')).toEqual([]);
    expect(await rows('select state, lost_leases, worker from app.kw_jobs')).toEqual([
      { state: 'dead', lost_leases: 3, worker: null },
    ]);
    const [history] = await rows('select outcome, attempts, error from app.kw_job_history');
    expect(history).toMatchObject({
      outcome: 'dead',
      attempts: 3,
      error: { code: 'core.job_lease_lost' },
    });
    expect(await countOf('done')).toEqual([1]);
  });
});
