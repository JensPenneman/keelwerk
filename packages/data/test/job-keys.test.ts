// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { Scope } from '@keelwerk/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { jobSpec } from './support/job-spec.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { ownerRows } from './support/owner-rows.ts';
import { restartJobIds } from './support/restart-job-ids.ts';
import { stamp } from './support/stamp.ts';
import { storeSuite } from './support/store-suite.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const store = storeSuite();

beforeEach(async () => {
  await restartJobIds(store.adapter);
});

const rows = async (sql: string): Promise<readonly Record<string, unknown>[]> =>
  ownerRows(store.adapter, sql);

const states = async (): Promise<readonly unknown[]> =>
  (await rows('select id::int as id, state, key from app.kw_jobs order by id')).map((row) => [
    row.id,
    row.state,
    row.key,
  ]);

describe('keys: keep, replace, coalesce', () => {
  const keyed = (
    onConflict: 'keep' | 'replace' | 'coalesce',
    over = {},
  ): ReturnType<typeof jobSpec> => jobSpec({ key: { value: 'k', onConflict }, ...over });

  test('keep leaves the pending job and returns its id', async () => {
    const ids = await store.run(tenantScope, async (unit) => [
      await unit.jobs.enqueue(keyed('keep', { run: { action: 'a', input: 1 } })),
      await unit.jobs.enqueue(keyed('keep', { run: { action: 'a', input: 2 } })),
    ]);
    expect(ids).toEqual(['1', '1']);
    expect(await rows('select input from app.kw_jobs')).toEqual([
      { input: { action: 'a', input: 1 } },
    ]);
  });

  test('replace swaps the pending job for the new one, writes a cancelled history row, and fixes the count', async () => {
    await store.run(tenantScope, (unit) =>
      unit.jobs.enqueue(keyed('replace', { run: { action: 'a', input: 1 } })),
    );
    const second = await store.run(tenantScope, (unit) =>
      unit.jobs.enqueue(keyed('replace', { run: { action: 'a', input: 2 } })),
    );
    expect(second).toBe('2');
    expect(await rows('select id::int as id, input from app.kw_jobs')).toEqual([
      { id: 2, input: { action: 'a', input: 2 } },
    ]);
    expect(
      await rows(
        'select job_id::int as job_id, queue, kind, outcome, attempts, started_at, error from app.kw_job_history',
      ),
    ).toEqual([
      {
        job_id: 1,
        queue: 'commands',
        kind: 'action',
        outcome: 'cancelled',
        attempts: 0,
        started_at: null,
        error: null,
      },
    ]);
    expect(
      await rows(`select value::int as n from app.kw_job_lane_counts where kind = 'enqueued'`),
    ).toEqual([{ n: 1 }]);
  });

  test('replace inside one unit leaves the count at one', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(keyed('replace'));
      await unit.jobs.enqueue(keyed('replace'));
    });
    expect(await states()).toEqual([[2, 'available', 'k']]);
    expect(
      await rows(`select value::int as n from app.kw_job_lane_counts where kind = 'enqueued'`),
    ).toEqual([{ n: 1 }]);
  });

  test('coalesce keeps one job and moves its time to the earliest, counting it when it falls due', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(keyed('coalesce', { runAt: stamp.add({ seconds: 60 }) }));
      await unit.jobs.enqueue(keyed('coalesce', { runAt: stamp.add({ seconds: 5 }) }));
    });
    const [pending] = await rows('select state, run_at from app.kw_jobs');
    expect(pending?.state).toBe('scheduled');
    expect(new Date(String(pending?.run_at)).toISOString()).toBe(
      stamp.add({ seconds: 5 }).toString({ smallestUnit: 'millisecond' }),
    );
    store.clock.advance(6000);
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(keyed('coalesce', { runAt: stamp })));
    expect(await states()).toEqual([[1, 'available', 'k']]);
    expect(
      await rows(`select value::int as n from app.kw_job_lane_counts where kind = 'enqueued'`),
    ).toEqual([{ n: 1 }]);
  });

  test('a key acts within its lane only, and a running job is not pending', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(keyed('keep'));
      await unit.jobs.enqueue(keyed('keep', { priority: 'high' }));
    });
    expect(await states()).toHaveLength(2);
    await rows(`update app.kw_jobs set state = 'running' where id = 1`);
    expect(await store.run(tenantScope, (unit) => unit.jobs.enqueue(keyed('keep')))).toBe('3');
  });

  test('fifo per key: a later job waits behind a running head and is cancelled with its key', async () => {
    const fifo = (over = {}): ReturnType<typeof jobSpec> =>
      jobSpec({ ordering: 'fifo-per-key', key: { value: 'q', onConflict: 'replace' }, ...over });
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(fifo()));
    await rows(`update app.kw_jobs set state = 'running'`);
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(
        jobSpec({ ordering: 'fifo-per-key', key: { value: 'q', onConflict: 'keep' } }),
      );
    });
    expect(await states()).toEqual([
      [1, 'running', 'q'],
      [2, 'waiting', 'q'],
    ]);
    expect(
      await rows(`select value::int as n from app.kw_job_lane_counts where kind = 'enqueued'`),
    ).toEqual([{ n: 1 }]);
    await store.run(tenantScope, (unit) => unit.jobs.cancel('commands', 'q'));
    expect(await states()).toEqual([[1, 'running', 'q']]);
  });

  test('cancel removes the pending jobs of a key, counts them, and leaves history', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ key: { value: 'a', onConflict: 'replace' } }));
      await unit.jobs.enqueue(
        jobSpec({ key: { value: 'b', onConflict: 'replace' }, runAt: stamp.add({ hours: 1 }) }),
      );
      await unit.jobs.enqueue(
        jobSpec({ key: { value: 'b', onConflict: 'replace' }, queue: 'other' }),
      );
    });
    expect(await store.run(tenantScope, (unit) => unit.jobs.cancel('commands', 'b'))).toBe(1);
    expect(await store.run(tenantScope, (unit) => unit.jobs.cancel('commands', 'b'))).toBe(0);
    expect(await store.run(tenantTwo, (unit) => unit.jobs.cancel('commands', 'a'))).toBe(0);
    expect(await store.run(tenantScope, (unit) => unit.jobs.cancel('commands', 'a'))).toBe(1);
    expect(await states()).toEqual([[3, 'available', 'b']]);
    expect(
      await rows(`select job_id::int as id, outcome from app.kw_job_history order by job_id`),
    ).toEqual([
      { id: 1, outcome: 'cancelled' },
      { id: 2, outcome: 'cancelled' },
    ]);
    expect(
      await rows(
        `select l.queue, c.value::int as n from app.kw_job_lane_counts c join app.kw_job_lanes l on l.id = c.lane_id
         where c.kind = 'enqueued' order by l.queue`,
      ),
    ).toEqual([
      { queue: 'commands', n: 0 },
      { queue: 'other', n: 1 },
    ]);
  });

  test('a namespace unit cancels across scopes', async () => {
    await store.run(tenantScope, (unit) =>
      unit.jobs.enqueue(jobSpec({ key: { value: 'a', onConflict: 'keep' } })),
    );
    await store.run(tenantTwo, (unit) =>
      unit.jobs.enqueue(
        jobSpec({ scope: tenantTwo as Scope, key: { value: 'a', onConflict: 'keep' } }),
      ),
    );
    expect(await store.run(namespaceScope, (unit) => unit.jobs.cancel('commands', 'a'))).toBe(2);
  });
});
