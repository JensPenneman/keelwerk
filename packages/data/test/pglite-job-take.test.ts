// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { StoredJob } from '@keelwerk/core';
import { CompiledQuery } from 'kysely';
import { beforeEach, describe, expect, test, vi } from 'vitest';
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

describe('take, lanes and counters', () => {
  test('a take marks jobs running with worker, attempt and lease, and moves taken and the virtual time', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ cost: 3 }));
      await unit.jobs.enqueue(jobSpec({ cost: 1 }));
    });
    const jobs = await take('w1', { leaseMs: 5000 });
    expect(jobs.map((job) => job.attempt.attempt)).toEqual([1, 1]);
    expect(
      await rows(
        'select state, worker, attempt, lease_until, started_at from app.kw_jobs order by id',
      ),
    ).toMatchObject([
      { state: 'running', worker: 'w1', attempt: 1 },
      { state: 'running', worker: 'w1', attempt: 1 },
    ]);
    const [lease] = await rows('select lease_until, started_at from app.kw_jobs order by id');
    expect(ms(lease?.lease_until)).toBe(stamp.epochMilliseconds + 5000);
    expect(ms(lease?.started_at)).toBe(stamp.epochMilliseconds);
    expect(await rows('select taken::int as taken, vtime from app.kw_job_lanes')).toEqual([
      { taken: 2, vtime: 4 },
    ]);
  });

  test('lanes are served by load per weight, then virtual time, then lane id', async () => {
    await store.run(tenantScope, async (unit) => {
      for (let n = 0; n < 4; n += 1) await unit.jobs.enqueue(jobSpec());
    });
    await store.run(tenantTwo, async (unit) => {
      for (let n = 0; n < 4; n += 1)
        await unit.jobs.enqueue(jobSpec({ scope: tenantTwo as never }));
    });
    await rows('update app.kw_job_lanes set weight = 3 where id = 1');
    const order: string[] = [];
    for (let n = 0; n < 4; n += 1) {
      const [job] = await take(`w${n}`, { limit: 1 });
      order.push(job?.scope.level === 'tenant' ? job.scope.tenantId.slice(-2) : '?');
    }
    expect(order).toEqual(['a1', 'a2', 'a1', 'a1']);
  });

  test('a lane never exceeds its cap, and a completion makes room again', async () => {
    await store.run(tenantScope, async (unit) => {
      for (let n = 0; n < 5; n += 1) await unit.jobs.enqueue(jobSpec({ laneCap: 2 }));
    });
    const first = await take('w1');
    expect(first).toHaveLength(2);
    expect(await take('w2')).toEqual([]);
    expect(await finish(first[0] as StoredJob, 'w1', succeeded)).toBe(true);
    expect(await take('w2')).toHaveLength(1);
    expect(await rows('select taken::int as taken from app.kw_job_lanes')).toEqual([{ taken: 3 }]);
    expect(await countOf('done')).toEqual([1]);
  });

  test('lanes: a request for fewer lanes than exist takes from the least loaded ones', async () => {
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec()));
    await store.run(tenantTwo, (unit) => unit.jobs.enqueue(jobSpec({ scope: tenantTwo as never })));
    const jobs = await take('w1', { limit: 10, lanes: 1 });
    expect(jobs).toHaveLength(1);
  });

  test('promotion counts jobs on their lane and honours the limit and the queue', async () => {
    await store.run(tenantScope, async (unit) => {
      for (const seconds of [10, 20, 30]) {
        await unit.jobs.enqueue(jobSpec({ runAt: stamp.add({ seconds }) }));
      }
    });
    expect(await countOf('enqueued')).toEqual([0]);
    store.clock.advance(25_000);
    expect(await store.run(namespaceScope, (unit) => unit.jobs.promote('other', 10))).toBe(0);
    expect(await store.run(namespaceScope, (unit) => unit.jobs.promote('commands', 1))).toBe(1);
    expect(await store.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10))).toBe(1);
    expect(await countOf('enqueued')).toEqual([2]);
    expect(await rows('select state from app.kw_jobs order by id')).toEqual([
      { state: 'available' },
      { state: 'available' },
      { state: 'scheduled' },
    ]);
  });
});

describe('groups', () => {
  const grouped = (over: Partial<ReturnType<typeof jobSpec>> = {}): ReturnType<typeof jobSpec> =>
    jobSpec({ group: { id: 'mx:example.com', concurrency: 5, rate: '2/1m' }, ...over });

  test('concurrency and tokens are counted under the group row; a job over its limit stays available', async () => {
    await store.run(tenantScope, async (unit) => {
      for (let n = 0; n < 3; n += 1) await unit.jobs.enqueue(grouped());
    });
    const jobs = await take('w1');
    expect(jobs).toHaveLength(2);
    const [counters] = await rows('select running, tokens, blocked_until from app.kw_job_groups');
    expect(counters).toMatchObject({ running: 2, tokens: 0 });
    expect(ms(counters?.blocked_until)).toBe(stamp.epochMilliseconds + 30_000);
    expect(await take('w2')).toEqual([]);
    const [blocked] = await rows('select blocked_until, running from app.kw_job_groups');
    expect(blocked?.running).toBe(2);
    expect(ms(blocked?.blocked_until)).toBe(stamp.epochMilliseconds + 30_000);
    expect(await rows('select state from app.kw_jobs order by id')).toEqual([
      { state: 'running' },
      { state: 'running' },
      { state: 'available' },
    ]);
  });

  test('a finished job gives its slot back; a rate-limited retry blocks the group until retryAfter', async () => {
    await store.run(tenantScope, async (unit) => {
      for (let n = 0; n < 3; n += 1) await unit.jobs.enqueue(grouped());
    });
    const [one, two] = await take('w1');
    await finish(one as StoredJob, 'w1', succeeded);
    expect(await rows('select running from app.kw_job_groups')).toEqual([{ running: 1 }]);
    await finish(two as StoredJob, 'w1', {
      kind: 'retry',
      at: stamp.add({ seconds: 90 }),
      error: { ...unavailable, kind: 'rate_limited', retryAfter: 12 },
    });
    const [group] = await rows('select running, blocked_until from app.kw_job_groups');
    expect(group?.running).toBe(0);
    expect(ms(group?.blocked_until)).toBe(stamp.epochMilliseconds + 12_000);
    expect(await take('w2')).toEqual([]);
    store.clock.advance(31_000);
    expect(await take('w2')).toHaveLength(1);
  });

  test('a group that spans the namespace is provisioned once and counted for every tenant', async () => {
    const group = { id: 'mx:shared', concurrency: 1, scope: 'namespace' } as const;
    await store.run(namespaceScope, (unit) => unit.jobs.provisionGroup(group));
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec({ group })));
    await store.run(tenantTwo, (unit) =>
      unit.jobs.enqueue(jobSpec({ group, scope: tenantTwo as never })),
    );
    expect(await take('w1')).toHaveLength(1);
    expect(await rows('select scope_id, running from app.kw_job_groups')).toEqual([
      { scope_id: null, running: 1 },
    ]);
    const [job] = await rows('select id::int as id from app.kw_jobs where state = $$running$$');
    expect(
      await finish(
        { attempt: { jobId: String(job?.id), attempt: 1 } } as StoredJob,
        'w1',
        succeeded,
      ),
    ).toBe(true);
    expect(await rows('select running from app.kw_job_groups')).toEqual([{ running: 0 }]);
    expect(await take('w2')).toHaveLength(1);
  });
});

describe('the reclaim of a take', () => {
  const chain = (n: number) =>
    jobSpec({ ordering: 'fifo-per-key', key: { value: `chain-${n}`, onConflict: 'append' } });
  const loseLeases = async (rounds: number): Promise<void> => {
    for (let round = 0; round < rounds; round += 1) {
      await take(`w${round}`, { leaseMs: 1000 });
      store.clock.advance(5000);
    }
  };

  test('the keys of the dying FIFO heads of one take are tried in one statement and held', async () => {
    await store.run(tenantScope, async (unit) => {
      for (const n of [1, 2, 3]) await unit.jobs.enqueue(chain(n));
    });
    await loseLeases(3);
    const { tries, held } = await store.run(namespaceScope, async (unit) => {
      const executed = vi.spyOn(unit.db, 'executeQuery');
      await unit.jobs.take('commands', 'w', {
        limit: 10,
        capabilitySets: [''],
        maxRevision: 100,
        leaseMs: 1000,
      });
      const texts = executed.mock.calls.map(([query]) => (query as CompiledQuery).sql);
      const [locks] = (
        await unit.db.executeQuery<{ n: string }>(
          CompiledQuery.raw(
            `select count(*)::text as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`,
          ),
        )
      ).rows;
      return {
        tries: texts.filter((text) => text.includes('pg_try_advisory_xact_lock')).length,
        held: Number(locks?.n),
      };
    });
    expect(tries).toBe(1);
    expect(held).toBe(3);
    expect(await rows('select state from app.kw_jobs order by id')).toEqual([
      { state: 'dead' },
      { state: 'dead' },
      { state: 'dead' },
    ]);
  });

  test('a take whose reclaim finds the group row of an expired job gone fails as internal', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ group: { id: 'mx:gone', concurrency: 5 } }));
    });
    await take('w1', { leaseMs: 1000 });
    store.clock.advance(5000);
    await rows('delete from app.kw_job_groups');
    await expect(take('w2')).rejects.toMatchObject({ kind: 'internal' });
  });

  test('a take whose pick finds the group row of an available job gone fails as internal', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ group: { id: 'mx:gone', concurrency: 5 } }));
    });
    await rows('delete from app.kw_job_groups');
    await expect(take('w1')).rejects.toMatchObject({ kind: 'internal' });
    expect(await rows('select state from app.kw_jobs')).toEqual([{ state: 'available' }]);
  });
});

describe('statistics', () => {
  test('due jobs, the oldest wait, arrivals, the next time and the mean run time', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ createdAt: stamp, runAt: stamp }));
      await unit.jobs.enqueue(jobSpec({ createdAt: stamp, runAt: stamp }));
      await unit.jobs.enqueue(jobSpec({ createdAt: stamp, runAt: stamp.add({ seconds: 600 }) }));
    });
    const [job] = await take('w1', { limit: 1 });
    store.clock.advance(4000);
    await finish(job as StoredJob, 'w1', succeeded);
    store.clock.advance(6000);
    const [row] = await store.run(namespaceScope, (unit) => unit.jobs.stats('commands'));
    expect(row).toEqual({
      queue: 'commands',
      capabilities: [],
      due: 1,
      oldestDueSeconds: 10,
      arrivalsPerSecond: 2 / 60,
      meanRunSeconds: 4,
      running: 0,
      // The job due now and the one scheduled ten minutes on; the finished one is not queued.
      queued: 2,
      nextDueAt: stamp,
      sloSeconds: 0,
    });
  });
});
