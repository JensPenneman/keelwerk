// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { StoredJob } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { eventHarness } from './support/event-harness.ts';
import { spec } from './support/job-store-fixtures.ts';
import type { Observed } from './support/take-kit.ts';
import { takeKit } from './support/take-kit.ts';

const harness = eventHarness('job_store_take_never_waits', 16);
const {
  inTenant,
  fifo,
  group,
  inputs,
  takeAll,
  enqueueFor,
  expireLeases,
  observe,
  holdingCount,
  stateOf,
  rowsOf,
} = takeKit(harness);

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

describe('a take inside a unit that holds what the reclaim needs', () => {
  test('a unit that changed the lane cap and then appends under the key of an expired head: the take does not wait for the lane, reports no skipped lane, and the append is not deadlocked', async () => {
    await enqueueFor([fifo(1)]);
    await expireLeases(1);
    let bodies = 0;
    let inside: Observed<{ jobs: readonly StoredJob[]; skippedLanes: number }> | undefined;
    await inTenant('open-cap', async (jobs) => {
      bodies += 1;
      await jobs.enqueue(spec(8, { laneCap: 11 }));
      inside = await observe('take-cap', () => takeAll('take-cap'));
      if (inside.waited) throw new Error('the take waited for the unit that changed the lane cap');
      await jobs.enqueue(fifo(2, { laneCap: 11 }));
    });
    expect(bodies).toBe(1);
    expect(await inside?.promise).toEqual({ jobs: [], skippedLanes: 0 });
    expect(await stateOf('chain')).toEqual([
      { state: 'running', lost_leases: 0 },
      { state: 'waiting', lost_leases: 0 },
    ]);
    expect(inputs((await takeAll('take-after-cap')).jobs)).toEqual([1, 8]);
  });

  test('a unit that re-limited the group of an expired head and then appends under its key: the take does not wait for the group row, reports no skipped lane, and the append is not deadlocked', async () => {
    await enqueueFor([fifo(1, { group: group(5) })]);
    await expireLeases(1);
    let bodies = 0;
    let inside: Observed<{ jobs: readonly StoredJob[]; skippedLanes: number }> | undefined;
    await inTenant('open-group-key', async (jobs) => {
      bodies += 1;
      await jobs.enqueue(spec(8, { group: group(6) }));
      inside = await observe('take-group-key', () => takeAll('take-group-key'));
      if (inside.waited) throw new Error('the take waited for the unit that re-limited the group');
      await jobs.enqueue(fifo(2, { group: group(6) }));
    });
    expect(bodies).toBe(1);
    expect(await inside?.promise).toEqual({ jobs: [], skippedLanes: 0 });
    expect(await stateOf('chain')).toEqual([
      { state: 'running', lost_leases: 0 },
      { state: 'waiting', lost_leases: 0 },
    ]);
    expect(inputs((await takeAll('take-after-group-key')).jobs)).toEqual([1, 8]);
  });

  test('an owner that holds the done counter of the lane: the take hands out the head of its first lost lease', async () => {
    await enqueueFor([fifo(1)]);
    await expireLeases(1);
    let inside: Observed<{ jobs: readonly StoredJob[] }> | undefined;
    await holdingCount('done', async () => {
      inside = await observe('take-done', () => takeAll('take-done'));
    });
    expect(inside?.waited).toBe(false);
    expect(inputs((await inside?.promise)?.jobs ?? [])).toEqual([1]);
    expect(await stateOf('chain')).toEqual([{ state: 'running', lost_leases: 1 }]);
  });

  test('a unit that re-limited the group of an available job: the take leaves the job and counts its lane as skipped; the next take hands it out', async () => {
    await enqueueFor([spec(1, { group: group(5) })]);
    let inside: Observed<{ jobs: readonly StoredJob[]; skippedLanes: number }> | undefined;
    await inTenant('open-group', async (jobs) => {
      await jobs.enqueue(spec(8, { group: group(6) }));
      inside = await observe('take-group', () => takeAll('take-group'));
      if (inside.waited) throw new Error('the take waited for the unit that re-limited the group');
    });
    expect(await inside?.promise).toEqual({ jobs: [], skippedLanes: 1 });
    expect(await rowsOf(`select state from app.kw_jobs order by id`)).toEqual([
      { state: 'available' },
      { state: 'available' },
    ]);
    expect(inputs((await takeAll('take-after-group')).jobs)).toEqual([1, 8]);
  });

  test('an owner that holds the done counter of the lane: a job at its third lost lease stays running, and the next take makes it dead', async () => {
    await enqueueFor([spec(1)]);
    await expireLeases(3);
    let inside: Observed<{ jobs: readonly StoredJob[]; skippedLanes: number }> | undefined;
    await holdingCount('done', async () => {
      inside = await observe('take-dying', () => takeAll('take-dying'));
    });
    expect(inside?.waited).toBe(false);
    expect(await inside?.promise).toEqual({ jobs: [], skippedLanes: 0 });
    expect(await rowsOf(`select state, lost_leases from app.kw_jobs`)).toEqual([
      { state: 'running', lost_leases: 2 },
    ]);
    expect((await takeAll('take-dead')).jobs).toEqual([]);
    expect(await rowsOf(`select state from app.kw_jobs`)).toEqual([{ state: 'dead' }]);
    expect(await rowsOf(`select outcome from app.kw_job_history`)).toEqual([{ outcome: 'dead' }]);
  });

  test('an owner that holds the enqueued counter of the lane: a FIFO head at its third lost lease stays running, and the next take ends it and hands out the follower', async () => {
    await enqueueFor([fifo(1), fifo(2)]);
    await expireLeases(3);
    let inside: Observed<{ jobs: readonly StoredJob[]; skippedLanes: number }> | undefined;
    await holdingCount('enqueued', async () => {
      inside = await observe('take-head', () => takeAll('take-head'));
    });
    expect(inside?.waited).toBe(false);
    expect(await inside?.promise).toEqual({ jobs: [], skippedLanes: 0 });
    expect(await stateOf('chain')).toEqual([
      { state: 'running', lost_leases: 2 },
      { state: 'waiting', lost_leases: 0 },
    ]);
    expect(inputs((await takeAll('take-after-head')).jobs)).toEqual([2]);
    expect(await stateOf('chain')).toEqual([
      { state: 'dead', lost_leases: 3 },
      { state: 'running', lost_leases: 0 },
    ]);
  });

  test('a unit that only inserted a job into the lane and then appends under the key of an expired head: the take does not wait for the lane and hands out the head, and the append is not deadlocked', async () => {
    await enqueueFor([fifo(1)]);
    await expireLeases(1);
    let bodies = 0;
    let inside: Observed<{ jobs: readonly StoredJob[]; skippedLanes: number }> | undefined;
    await inTenant('open-insert', async (jobs) => {
      bodies += 1;
      // The insert holds `for key share` on the lane row until the unit ends; no cap or limit changes.
      await jobs.enqueue(spec(8));
      inside = await observe('take-insert', () => takeAll('take-insert'));
      if (inside.waited)
        throw new Error('the take waited for the unit that inserted into the lane');
      await jobs.enqueue(fifo(2));
    });
    expect(bodies).toBe(1);
    expect(inputs((await inside?.promise)?.jobs ?? [])).toEqual([1]);
    expect(await stateOf('chain')).toEqual([
      { state: 'running', lost_leases: 1 },
      { state: 'waiting', lost_leases: 0 },
    ]);
    expect(inputs((await takeAll('take-after-insert')).jobs)).toEqual([8]);
  });

  test('an open unit that holds the key of a dying FIFO head in a lane with no takeable job: the take answers without waiting and without a skipped lane, leaves the head, and the next take after the unit ended ends it and hands out the follower', async () => {
    await enqueueFor([fifo(1)]);
    await expireLeases(3);
    let inside: Observed<{ jobs: readonly StoredJob[]; skippedLanes: number }> | undefined;
    await inTenant('open-key', async (jobs) => {
      await jobs.enqueue(fifo(2));
      inside = await observe('take-key', () => takeAll('take-key'));
      if (inside.waited) throw new Error('the take waited for the unit that holds the key');
    });
    expect(await inside?.promise).toEqual({ jobs: [], skippedLanes: 0 });
    expect(await stateOf('chain')).toEqual([
      { state: 'running', lost_leases: 2 },
      { state: 'waiting', lost_leases: 0 },
    ]);
    expect(inputs((await takeAll('take-after-key')).jobs)).toEqual([2]);
    expect(await stateOf('chain')).toEqual([
      { state: 'dead', lost_leases: 3 },
      { state: 'running', lost_leases: 0 },
    ]);
  });
});
