// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import { describe, expect, test } from 'vitest';
import { eventHarness } from './support/event-harness.ts';
import { spec, tenant } from './support/job-store-fixtures.ts';
import { taggedUnit } from './support/tagged-unit.ts';
import { takeKit } from './support/take-kit.ts';

const harness = eventHarness('job_lane_weight_held', 8);
const { inputs, takeAll, observe, holdingCount, rowsOf } = takeKit(harness);
const { clock, run, owner } = harness;

/*
 * A unit that changes only the weight of a lane writes the lane's row at its end, just before its
 * commit tail, and holds it until it ends; a take that meets the held row skips the lane and never
 * waits, so the queue has to be reported as made takeable when that unit commits (9.5.2). What
 * decides the case: a client of the owner holds the `enqueued` counter of a second lane, which the
 * unit's ready job in that lane makes its tail wait for, so the unit is seen waiting (a look at the
 * server) in its end, after it wrote the first lane's row; the clock is never moved, so no job of
 * the first lane is due by time and no poll could find it: what brings it back is what the
 * committed unit reports, which the case reads.
 */

describe('a lane whose weight a unit in its end changed', () => {
  test('a take skips the lane and leaves the ready job; the unit that commits reports the queue, and the next take hands the job out', async () => {
    const later = clock.now().add({ hours: 1 });
    // Lane 1 (`commands`) holds a ready job; lane 2 (`other`) exists with a job for later.
    await run(tenant(0), async (unit) => {
      await unit.jobs.enqueue(spec(1));
      await unit.jobs.enqueue(spec(2, { queue: 'other', runAt: later }));
    });
    const lanes = await rowsOf(`select id::text as id, queue from app.kw_job_lanes order by id`);
    const second = String(lanes.find((lane) => lane.queue === 'other')?.id);
    let reported: readonly string[] | undefined;
    let unit: Awaited<ReturnType<typeof observe<void>>> | undefined;
    let skipped: Awaited<ReturnType<typeof takeAll>> | undefined;
    let held = false;
    await holdingCount(
      'enqueued',
      async () => {
        unit = await observe('weight-unit', () =>
          taggedUnit(
            harness.adapter(),
            harness.clock,
            tenant(0),
            'job-store:weight-unit',
            async (u) => {
              // Its own job is for later: only the weight makes the first lane's queue takeable.
              await u.jobs.enqueue(spec(3, { laneWeight: 3, runAt: later }));
              // A ready job of the second lane: its tail waits for the counter the owner holds.
              await u.jobs.enqueue(spec(4, { queue: 'other' }));
              reported = u.jobs.readied();
            },
          ),
        );
        if (unit.waited !== true) throw new Error('the unit did not wait in its end');
        skipped = await takeAll('take-skips');
        // The first lane's row is held by the unit in its end: the owner finds it locked.
        await owner(async (client) => {
          await client.query('begin');
          try {
            await client.query(
              `select 1 from app.kw_job_lanes where queue = 'commands' for no key update nowait`,
            );
          } catch (error) {
            held = (error as { code?: string }).code === '55P03';
          } finally {
            await client.query('rollback');
          }
        });
      },
      second,
    );
    await unit?.promise;
    expect(held).toBe(true);
    expect(skipped).toEqual({ jobs: [], skippedLanes: 1 });
    expect(reported).toEqual(['commands', 'other']);
    expect(inputs((await takeAll('take-after')).jobs)).toEqual([1]);
  });
});
