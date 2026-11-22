// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import { describe, expect, test } from 'vitest';
import { eventHarness } from './support/event-harness.ts';
import { spec, tenant } from './support/job-store-fixtures.ts';
import { taggedUnit } from './support/tagged-unit.ts';
import { takeKit } from './support/take-kit.ts';

const harness = eventHarness('job_lane_order', 12);
const { observe, rowsOf, inputs, takeAll, enqueueFor, group, inTenant } = takeKit(harness);
const { owner, run } = harness;

/*
 * A unit writes the cap and weight of the lanes it changes at its end, in ascending lane id, so two
 * units that change two lanes never wait for each other in a cycle (9.5.2). What decides the cases:
 * a client of the owner holds the row of one lane (`for no key update`, which the units' job inserts
 * do not conflict with) while a unit is open and has enqueued, so the unit is seen waiting at its
 * end by a look at the server. The first case holds the higher lane and asks, while the unit that
 * enqueued the higher lane first waits for it, whether that unit already holds the lower lane's
 * row (`nowait` is refused): it does only when its rows are written in ascending order, whatever
 * the order of its enqueues. The second case has two units that change the two lanes in opposite
 * order wait for the same row; which of them PostgreSQL grants the row first is not decided by the
 * order they came in (a row that several units have locked for key share has no queue), so it only
 * says that both commit and that each lane has the values of one unit. Nothing waits for a time to pass.
 *
 * The last describe is the same with a group: the end step of a unit that completed a grouped job
 * and a drain's release of a job of the same group take the group's row before the lane rows, whatever
 * the lanes' order. There the owner holds the lower lane, X holds the group's row and waits for that
 * lane, and Y is seen waiting for the group's row: it holds no lane row, so when the owner lets go X
 * takes both lanes and Y follows. A release that locked the high lane's row before the group's row
 * would hold it while it waits for X, and X's write of that lane would close the cycle.
 */

const lanes = async () => {
  const rows = await rowsOf(
    `select id::text as id, queue, cap, weight from app.kw_job_lanes order by id`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    queue: String(row.queue),
    cap: Number(row.cap),
    weight: Number(row.weight),
  }));
};

/** A unit that enqueues into `queues` in this order with cap `cap` and ends. */
const changing = (label: string, queues: readonly string[], cap: number, start: number) =>
  taggedUnit(harness.adapter(), harness.clock, tenant(0), `job-store:${label}`, async (unit) => {
    let n = start;
    for (const queue of queues) {
      n += 1;
      await unit.jobs.enqueue(spec(n, { queue, laneCap: cap, runAt: later() }));
    }
  });

/** Due in an hour: the jobs enqueued here move no lane's counter, so only the lane rows are written. */
const later = () => harness.clock.now().add({ hours: 1 });

const seed = async () => {
  await run(tenant(0), async (unit) => {
    await unit.jobs.enqueue(spec(1, { queue: 'commands', laneCap: 10, runAt: later() }));
    await unit.jobs.enqueue(spec(2, { queue: 'other', laneCap: 10, runAt: later() }));
  });
  const [low, high] = await lanes();
  if (low === undefined || high === undefined) throw new Error('the lanes were not created');
  return { low: low.id, high: high.id };
};

describe('the lane rows a unit changes are written in the order of the lane ids', () => {
  test('a unit that enqueued the higher lane first holds the lower lane while it waits for the higher one', async () => {
    const { low, high } = await seed();
    let unit: Awaited<ReturnType<typeof observe<void>>> | undefined;
    await owner(async (client) => {
      await client.query('begin');
      try {
        await client.query(
          `select 1 from app.kw_job_lanes where id = $1::bigint for no key update`,
          [high],
        );
        unit = await observe('order-high-first', () =>
          changing('order-high-first', ['other', 'commands'], 12, 10),
        );
        if (unit.waited !== true)
          throw new Error('the unit did not wait for the row the owner holds');
        // The unit holds the lower lane: a second client is refused its row at once.
        await owner(async (second) => {
          await second.query('begin');
          try {
            await expect(
              second.query(
                `select 1 from app.kw_job_lanes where id = $1::bigint for no key update nowait`,
                [low],
              ),
            ).rejects.toMatchObject({ code: '55P03' });
          } finally {
            await second.query('rollback');
          }
        });
      } finally {
        await client.query('rollback');
      }
    });
    await unit?.promise;
    expect((await lanes()).map(({ queue, cap }) => ({ queue, cap }))).toEqual([
      { queue: 'commands', cap: 12 },
      { queue: 'other', cap: 12 },
    ]);
  });

  test('two units that changed two lanes in opposite order both commit, and each lane has the values of one of them', async () => {
    const { low } = await seed();
    let a: Awaited<ReturnType<typeof observe<void>>> | undefined;
    let b: Awaited<ReturnType<typeof observe<void>>> | undefined;
    // The owner holds the lower lane's row while both units are open and have enqueued.
    await owner(async (client) => {
      await client.query('begin');
      try {
        await client.query(
          `select 1 from app.kw_job_lanes where id = $1::bigint for no key update`,
          [low],
        );
        a = await observe('order-x', () => changing('order-x', ['commands', 'other'], 11, 10));
        if (a.waited !== true) throw new Error('unit X did not wait for the row the owner holds');
        b = await observe('order-y', () => changing('order-y', ['other', 'commands'], 12, 20));
        if (b.waited !== true) throw new Error('unit Y did not wait for the row the owner holds');
      } finally {
        await client.query('rollback');
      }
    });
    await a?.promise;
    await b?.promise;
    const caps = (await lanes()).map(({ cap }) => cap);
    expect(caps[0]).toBe(caps[1]);
    expect([11, 12]).toContain(caps[0]);
  });

  test('a lane changed twice in one unit is written with the last value, and not before the unit ends', async () => {
    const { low } = await seed();
    await run(tenant(0), async (unit) => {
      await unit.jobs.enqueue(spec(3, { laneCap: 11, laneWeight: 2, runAt: later() }));
      await unit.jobs.enqueue(spec(4, { laneCap: 12, laneWeight: 3, runAt: later() }));
      const [before] = await rowsOf(`select cap, weight from app.kw_job_lanes where id = ${low}`);
      expect(before).toEqual({ cap: 10, weight: 1 });
    });
    const [after] = await rowsOf(`select cap, weight from app.kw_job_lanes where id = ${low}`);
    expect(after).toEqual({ cap: 12, weight: 3 });
  });

  test('a lane given back the values it has in the table is left as it was, whatever the unit gave it before', async () => {
    const { low } = await seed();
    await run(tenant(0), async (unit) => {
      await unit.jobs.enqueue(spec(3, { laneCap: 12, laneWeight: 3, runAt: later() }));
      await unit.jobs.enqueue(spec(4, { laneCap: 10, laneWeight: 1, runAt: later() }));
    });
    const [after] = await rowsOf(`select cap, weight from app.kw_job_lanes where id = ${low}`);
    expect(after).toEqual({ cap: 10, weight: 1 });
  });
});

describe('an open unit that changed a lane leaves its row unlocked', () => {
  test('a take hands out the ready job of the lane the unit changed and skips none', async () => {
    await run(tenant(0), async (unit) => void (await unit.jobs.enqueue(spec(1))));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const changingUnit = run(tenant(0), async (unit) => {
      await unit.jobs.enqueue(spec(2, { laneCap: 11, laneWeight: 3, runAt: later() }));
      entered.resolve();
      await release.promise;
    });
    let taken: Awaited<ReturnType<typeof takeAll>> | undefined;
    let free = false;
    try {
      await entered.promise;
      taken = await takeAll('take-open-unit');
      // The row of the lane is not held by the open unit: the owner takes it at once.
      await owner(async (client) => {
        await client.query('begin');
        try {
          await client.query(`select 1 from app.kw_job_lanes for no key update nowait`);
          free = true;
        } finally {
          await client.query('rollback');
        }
      });
    } finally {
      release.resolve();
      await changingUnit;
    }
    expect(free).toBe(true);
    expect(inputs(taken?.jobs ?? [])).toEqual([1]);
    expect(taken?.skippedLanes).toBe(0);
  });
});

describe('the end step of a unit and a drain release take the group row before the lane rows', () => {
  test('a unit that completed a grouped job and changes two lanes, and a release of a job of the same group in the higher lane, both commit', async () => {
    await enqueueFor([spec(3, { queue: 'other', runAt: later() })]);
    await enqueueFor([spec(1, { group: group(2) }), spec(2, { group: group(2) })]);
    const [low] = await lanes();
    if (low === undefined) throw new Error('the lane was not created');
    const taken = await takeAll('order-seed-take');
    const byInput = (n: number) => taken.jobs.find((job) => inputs([job])[0] === n);
    const [first, second] = [byInput(1), byInput(2)];
    if (first === undefined || second === undefined) throw new Error('two jobs were not taken');
    let x: Awaited<ReturnType<typeof observe<boolean>>> | undefined;
    let y: Awaited<ReturnType<typeof observe<readonly unknown[]>>> | undefined;
    await owner(async (client) => {
      await client.query('begin');
      try {
        await client.query(
          `select 1 from app.kw_job_lanes where id = $1::bigint for no key update`,
          [low.id],
        );
        // X completes the first job, then changes the lower lane and the higher lane (its jobs'): its
        // end step takes the group row and then waits for the lower lane's row, which the owner holds.
        x = await observe('order-gx', () =>
          inTenant('order-gx', async (jobs) => {
            const done = await jobs.complete(first.attempt, 'w2', { kind: 'succeeded' });
            await jobs.enqueue(spec(4, { queue: 'other', laneCap: 11, runAt: later() }));
            await jobs.enqueue(spec(5, { laneCap: 11, runAt: later() }));
            return done;
          }),
        );
        if (x.waited !== true) throw new Error('unit X did not wait for the lane the owner holds');
        // Y releases the second job, which is in the higher lane and in the group X holds.
        y = await observe('order-gy', () =>
          inTenant('order-gy', (jobs) => jobs.release([second.attempt], 'w2')),
        );
        if (y.waited !== true) throw new Error('unit Y did not wait for the group row X holds');
      } finally {
        await client.query('rollback');
      }
    });
    expect(await x?.promise).toBe(true);
    expect((await y?.promise)?.length).toBe(1);
  });
});
