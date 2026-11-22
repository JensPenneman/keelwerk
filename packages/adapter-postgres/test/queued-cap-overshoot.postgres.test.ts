// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import { describe, expect, test } from 'vitest';
import { eventHarness } from './support/event-harness.ts';
import { spec, tenant } from './support/job-store-fixtures.ts';
import { taggedUnit } from './support/tagged-unit.ts';
import { takeKit } from './support/take-kit.ts';

const harness = eventHarness('queued_cap_overshoot', 16);
const { holdingCount, observe, rowsOf } = takeKit(harness);

/*
 * What decides the cases: a client of the owner holds a row the tail of a unit waits for (the
 * `enqueued` row of the lane in one case, the usage row both units charge in the other), so that
 * the tail statements of two units are open at once: unit A is seen waiting in its tail by a look
 * at the server, and only then is unit B started and seen waiting too. Each tail statement took its
 * snapshot before the other unit committed, so each counts the two committed jobs and its own and
 * is admitted at the cap of 3; released, both commit and the queue holds one job more than its
 * cap, the bound the documentation states (the jobs of all the units but the largest, here one).
 * A third unit then reads the four committed jobs and is refused. Both looks are positive looks of
 * the server (`lockLook`), so nothing here waits for a time to pass.
 */

const cap = 3;
const dimension = 'core.rows';

/** A unit with a usage charge and one capped job in `priority`'s lane, which ends with its commit tail. */
const writing = (label: string, n: number, priority: 'high' | 'normal' | 'low') =>
  taggedUnit(harness.adapter(), harness.clock, tenant(0), `job-store:${label}`, async (unit) => {
    unit.usage.charge([{ dimension, delta: 1n, limit: null }]);
    await unit.jobs.enqueue(spec(n, { queuedCap: cap, priority }));
  });

const queuedJobs = async (): Promise<number> =>
  Number(
    (
      await rowsOf(
        `select count(*)::int as n from app.kw_jobs where state in ('scheduled', 'available', 'waiting')`,
      )
    )[0]?.n,
  );

/** The third unit, which reads the committed jobs of both. */
const third = () => harness.failure(writing('third', 9, 'normal'));

describe('units that commit at the same moment can pass the queued cap by the jobs of all of them but the largest', () => {
  test('two units in one lane, held at the lane counter row, both commit at the cap and a third is refused', async () => {
    await writing('seed-1', 1, 'normal');
    await writing('seed-2', 2, 'normal');
    expect(await queuedJobs()).toBe(2);
    let a: Awaited<ReturnType<typeof observe<void>>> | undefined;
    let b: Awaited<ReturnType<typeof observe<void>>> | undefined;
    try {
      await holdingCount('enqueued', async () => {
        a = await observe('tail-a', () => writing('tail-a', 3, 'normal'));
        if (a.waited !== true) throw new Error('unit A did not wait for the lane counter row');
        b = await observe('tail-b', () => writing('tail-b', 4, 'normal'));
        if (b.waited !== true) throw new Error('unit B committed past unit A, or was refused');
      });
    } finally {
      // A unit that was started is finished before the next case begins, whatever failed.
      await Promise.allSettled([a?.promise, b?.promise]);
    }
    expect(await queuedJobs()).toBe(cap + 1);
    expect(await third()).toEqual({ kind: 'rate_limited', code: 'core.queue_full' });
    expect(await queuedJobs()).toBe(cap + 1);
  });

  test('two units in two lanes of one queue, held at the usage row, pass the cap alike', async () => {
    await writing('seed-1', 1, 'normal');
    await writing('seed-2', 2, 'normal');
    let a: Awaited<ReturnType<typeof observe<void>>> | undefined;
    let b: Awaited<ReturnType<typeof observe<void>>> | undefined;
    try {
      await harness.owner(async (client) => {
        await client.query('begin');
        try {
          await client.query(`select 1 from app.kw_usage where dimension = $1 for update`, [
            dimension,
          ]);
          a = await observe('tail-a', () => writing('tail-a', 3, 'high'));
          if (a.waited !== true) throw new Error('unit A did not wait for the usage row');
          b = await observe('tail-b', () => writing('tail-b', 4, 'low'));
          if (b.waited !== true) throw new Error('unit B committed past unit A, or was refused');
        } finally {
          await client.query('rollback');
        }
      });
    } finally {
      await Promise.allSettled([a?.promise, b?.promise]);
    }
    const lanes = await rowsOf(`select count(*)::int as n from app.kw_job_lanes`);
    expect(lanes[0]?.n).toBe(3);
    expect(await queuedJobs()).toBe(cap + 1);
    expect(await third()).toEqual({ kind: 'rate_limited', code: 'core.queue_full' });
  });
});
