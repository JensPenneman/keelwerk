// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import { describe, expect, test } from 'vitest';
import { eventHarness } from './support/event-harness.ts';
import { spec, tenant } from './support/job-store-fixtures.ts';
import { taggedUnit } from './support/tagged-unit.ts';
import { takeKit } from './support/take-kit.ts';

const harness = eventHarness('commit_tail_lock_order', 16);
const { holdingCount, observe, rowsOf } = takeKit(harness);

/*
 * What decides the case: a client of the owner holds the `enqueued` row of lane 1 for the whole
 * case, as a take that is promoting a due job in that lane does; unit A (a usage charge and a job
 * in lane 1) is seen waiting for that row in its tail, so it holds its usage row; unit B (a usage
 * charge and a job in lane 2) is started only after that look and is seen waiting too. Both looks
 * are positive looks of the server (`lockLook`), so nothing here waits for a time to pass. B waits
 * for the usage row that A holds, which it asks for before any `enqueued` row, so it holds no row of
 * lane 2: the owner's `for update nowait` on that row succeeds. Taken the other way round (the
 * counts before the usage), B would hold lane 2's row while it waits, and A would not wait for
 * lane 1 until it had the usage row, so B would commit before the look.
 */

const dimension = 'core.rows';

/** A unit with one usage charge and one job in `queue`, which ends with its commit tail. */
const writing = (label: string, queue: string, n: number) =>
  taggedUnit(harness.adapter(), harness.clock, tenant(0), `job-store:${label}`, async (unit) => {
    unit.usage.charge([{ dimension, delta: BigInt(n), limit: null }]);
    await unit.jobs.enqueue(spec(n, { queue }));
  });

describe('the commit tail takes its locks in one order', () => {
  test('a tail that waits for an enqueued row holds the usage row, and the tail behind it holds no row of another lane', async () => {
    // Both lanes and the usage row exist before the case starts.
    await writing('seed-1', 'commands', 1);
    await writing('seed-2', 'other', 2);
    const lanes = await rowsOf(`select id::text as id, queue from app.kw_job_lanes order by queue`);
    expect(lanes.map((lane) => lane.queue)).toEqual(['commands', 'other']);
    const [first, second] = lanes.map((lane) => String(lane.id));
    const usageBefore = await rowsOf(
      `select value::text as value from app.kw_usage where dimension = '${dimension}'`,
    );

    let a: Awaited<ReturnType<typeof observe<void>>> | undefined;
    let b: Awaited<ReturnType<typeof observe<void>>> | undefined;
    let free = false;
    await holdingCount(
      'enqueued',
      async () => {
        a = await observe('tail-a', () => writing('tail-a', 'commands', 3));
        if (a.waited !== true)
          throw new Error('unit A did not wait for the lane it shares with the owner');
        b = await observe('tail-b', () => writing('tail-b', 'other', 4));
        if (b.waited !== true)
          throw new Error('unit B committed past unit A: it took lane 2 before the usage row');
        // The owner takes lane 2's row with `nowait`: it throws 55P03 when unit B holds it.
        await harness.owner(async (client) => {
          await client.query('begin');
          try {
            await client.query(
              `select 1 from app.kw_job_lane_counts where lane_id = $1::bigint and kind = 'enqueued' for update nowait`,
              [second],
            );
            free = true;
          } finally {
            await client.query('rollback');
          }
        });
      },
      first,
    );
    expect(free).toBe(true);
    await a?.promise;
    await b?.promise;
    const counts = await rowsOf(
      `select lane_id::text as lane, value from app.kw_job_lane_counts where kind = 'enqueued' order by lane_id`,
    );
    expect(counts).toEqual([
      { lane: first, value: '2' },
      { lane: second, value: '2' },
    ]);
    const usageAfter = await rowsOf(
      `select value::text as value from app.kw_usage where dimension = '${dimension}'`,
    );
    // Unit A charged 3 and unit B 4.
    expect(BigInt(String(usageAfter[0]?.value))).toBe(BigInt(String(usageBefore[0]?.value)) + 7n);
  });
});
