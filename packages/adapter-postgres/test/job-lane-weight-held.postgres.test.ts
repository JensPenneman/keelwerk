import type { Unit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { eventHarness } from './support/event-harness.ts';
import { spec, tenant } from './support/job-store-fixtures.ts';
import { takeKit } from './support/take-kit.ts';

const harness = eventHarness('job_lane_weight_held', 8);
const { inputs, takeAll, observe } = takeKit(harness);
const { clock, run } = harness;

/*
 * An enqueue that changes only the weight of a lane writes the lane's row and holds it until its
 * unit ends; a take that meets the held row skips the lane and never waits, so the queue has to be
 * reported as made takeable when that unit commits (9.5.2). What decides the case: the unit that
 * changes the weight is opened by the case and ends only after the take under test has ended; the
 * clock is never moved, so no job is due by time and no poll could find the job: what brings it back
 * is what the committed unit reports, which the case reads.
 */

describe('a lane whose weight an open unit changes', () => {
  test('a take skips the lane and leaves the ready job; the unit that commits reports the queue, and the next take hands the job out', async () => {
    await run(tenant(0), async (unit) => void (await unit.jobs.enqueue(spec(1))));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let committed: Unit | undefined;
    // Its own job is for later: nothing but the changed weight can make the queue takeable.
    const later = clock.now().add({ hours: 1 });
    const changing = run(tenant(0), async (unit) => {
      await unit.jobs.enqueue(spec(2, { laneWeight: 3, runAt: later }));
      committed = unit;
      entered.resolve();
      await release.promise;
    });
    let skipped: Awaited<
      ReturnType<typeof observe<{ jobs: readonly unknown[]; skippedLanes: number }>>
    >;
    try {
      await entered.promise;
      skipped = await observe('take-skips', () => takeAll('take-skips'));
      expect(skipped.waited).toBe(false);
    } finally {
      release.resolve();
      await changing;
    }
    expect(await skipped.promise).toEqual({ jobs: [], skippedLanes: 1 });
    expect(committed?.jobs.readied()).toEqual(['commands']);
    expect(inputs((await takeAll('take-after')).jobs)).toEqual([1]);
  });
});
