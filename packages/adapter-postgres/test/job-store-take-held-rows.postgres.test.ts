// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { StoredJob } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { eventHarness } from './support/event-harness.ts';
import { spec, tenant } from './support/job-store-fixtures.ts';
import type { Observed } from './support/take-kit.ts';
import { takeKit } from './support/take-kit.ts';

const harness = eventHarness('job_store_take_held_rows', 16);
const {
  inputs,
  takeAll,
  promoteAndTake,
  enqueueFor,
  observe,
  holdingCount,
  holdingJobRows,
  rowsOf,
} = takeKit(harness);
const { clock, run } = harness;

/*
 * What decides every case below: the unit or the client that holds a lock is opened and ended by the
 * case itself, and ends only after the take under test has ended or a look has seen it wait on a
 * lock. A take that waits therefore waits for certain (the holder is open), and a take that does
 * not wait ends while the holder is open; nothing in the background (no worker, no fetcher) moves a
 * job, a lease or a counter. A lease of 1 s is expired by a clock advance of 5 s. `skippedLanes`
 * counts the lanes whose takeable jobs the take could not look at (a lane another taker holds, a
 * job's group row another unit holds); a lane in which only a reclaim, a promotion or a release was
 * left behind a held row is not counted, so those cases answer 0 and the next take does the work.
 */

describe('a take unit beside the counter and job rows of its promotion and pick', () => {
  test('an owner that holds the enqueued counter of the lane: a take unit leaves a due job scheduled, and one unit later promotes and takes it', async () => {
    await enqueueFor([spec(1, { runAt: clock.now().add({ seconds: 10 }) })]);
    clock.advance(11_000);
    let inside:
      | Observed<{ promoted: number; jobs: readonly StoredJob[]; skippedLanes: number }>
      | undefined;
    await holdingCount('enqueued', async () => {
      inside = await observe('take-promote', () => promoteAndTake('take-promote'));
    });
    expect(inside?.waited).toBe(false);
    expect(await inside?.promise).toEqual({ promoted: 0, jobs: [], skippedLanes: 0 });
    expect(await rowsOf(`select state from app.kw_jobs`)).toEqual([{ state: 'scheduled' }]);
    const next = await promoteAndTake('take-promote-after');
    expect(next.promoted).toBe(1);
    expect(next.skippedLanes).toBe(0);
    expect(inputs(next.jobs)).toEqual([1]);
  });

  test('an owner that holds the enqueued counter of one tenant lane: a take unit promotes and takes the due job of another tenant, leaves the held lane to a later unit, and does not wait', async () => {
    const due = clock.now().add({ seconds: 10 });
    await run(tenant(0), async (unit) => void (await unit.jobs.enqueue(spec(1, { runAt: due }))));
    await run(
      tenant(1),
      async (unit) => void (await unit.jobs.enqueue(spec(2, { runAt: due, scope: tenant(1) }))),
    );
    clock.advance(11_000);
    const [held] = await rowsOf(
      `select lane_id::text as lane from app.kw_jobs where (input->>'input')::int = 1`,
    );
    let inside:
      | Observed<{ promoted: number; jobs: readonly StoredJob[]; skippedLanes: number }>
      | undefined;
    await holdingCount(
      'enqueued',
      async () => {
        inside = await observe('take-tenants', () => promoteAndTake('take-tenants'));
      },
      String(held?.lane),
    );
    expect(inside?.waited).toBe(false);
    const answer = await inside?.promise;
    expect(answer?.promoted).toBe(1);
    expect(inputs(answer?.jobs ?? [])).toEqual([2]);
    expect(answer?.skippedLanes).toBe(0);
    expect(await rowsOf(`select state from app.kw_jobs order by id`)).toEqual([
      { state: 'scheduled' },
      { state: 'running' },
    ]);
    const next = await promoteAndTake('take-tenants-after');
    expect(next.promoted).toBe(1);
    expect(inputs(next.jobs)).toEqual([1]);
  });

  test('an owner that holds the row of a due scheduled job: a take unit does not wait for it, promotes nothing, and one unit later promotes and takes it', async () => {
    await enqueueFor([spec(1, { runAt: clock.now().add({ seconds: 10 }) })]);
    clock.advance(11_000);
    let inside:
      | Observed<{ promoted: number; jobs: readonly StoredJob[]; skippedLanes: number }>
      | undefined;
    await holdingJobRows('scheduled', async () => {
      inside = await observe('take-due-row', () => promoteAndTake('take-due-row'));
    });
    expect(inside?.waited).toBe(false);
    expect((await inside?.promise)?.promoted).toBe(0);
    expect((await inside?.promise)?.jobs).toEqual([]);
    expect(await rowsOf(`select state from app.kw_jobs`)).toEqual([{ state: 'scheduled' }]);
    const next = await promoteAndTake('take-due-row-after');
    expect(next.promoted).toBe(1);
    expect(inputs(next.jobs)).toEqual([1]);
  });

  test('an owner that holds the row of an available job: the take does not wait for it, hands out nothing, and the next take hands the job out', async () => {
    await enqueueFor([spec(1)]);
    let inside: Observed<{ jobs: readonly StoredJob[]; skippedLanes: number }> | undefined;
    await holdingJobRows('available', async () => {
      inside = await observe('take-job-row', () => takeAll('take-job-row'));
    });
    expect(inside?.waited).toBe(false);
    expect((await inside?.promise)?.jobs).toEqual([]);
    expect(await rowsOf(`select state from app.kw_jobs`)).toEqual([{ state: 'available' }]);
    expect(inputs((await takeAll('take-job-row-after')).jobs)).toEqual([1]);
  });
});
