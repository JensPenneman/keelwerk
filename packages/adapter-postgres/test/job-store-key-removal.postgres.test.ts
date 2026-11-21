// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { JobStore, StoredJobSpec } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { eventHarness } from './support/event-harness.ts';
import { pause, spec, tenant } from './support/job-store-fixtures.ts';
import { taggedUnit } from './support/tagged-unit.ts';

const { adapter, clock, run, owner } = eventHarness('job_store_removal', 16);

const fifo = (n: number): StoredJobSpec =>
  spec(n, { ordering: 'fifo-per-key', key: { value: 'chain', onConflict: 'append' } });

const inTenant = <T>(label: string, fn: (jobs: JobStore) => Promise<T>): Promise<T> =>
  taggedUnit(adapter(), clock, tenant(0), `job-store:${label}`, async (unit) => fn(unit.jobs));

async function enqueueFor(n: number, jobs: readonly StoredJobSpec[]): Promise<void> {
  await run(tenant(n), async (unit) => {
    for (const job of jobs) await unit.jobs.enqueue({ ...job, scope: tenant(n) });
  });
}

describe('a removal by key that waits for a lane, while the key gets a head in another lane', () => {
  /** Whether the backend of `label` waits for the advisory lock of this lane and the key `chain`. */
  async function waitsOnKeyLock(label: string, laneId: string): Promise<boolean> {
    const [row] = await owner(
      async (client) =>
        (
          await client.query(
            `with want as (select hashtextextended($2, 0) as h)
             select 1 from pg_locks l
             join pg_stat_activity a on a.pid = l.pid
             cross join want
             where l.locktype = 'advisory' and not l.granted and a.application_name = $1
               and l.classid::text::numeric * 4294967296 + l.objid::text::numeric
                 = want.h::numeric + case when want.h < 0 then 18446744073709551616 else 0 end`,
            [`kwtest:job-store:${label}`, `app:${laneId}:chain`],
          )
        ).rows,
    );
    return row !== undefined;
  }

  const laneOf = async (priority: number): Promise<string> => {
    const [row] = await owner(
      async (client) =>
        (
          await client.query(
            `select id::text as id from app.kw_job_lanes where priority = $1::smallint`,
            [priority],
          )
        ).rows,
    );
    return String(row?.id);
  };

  /**
   * An append in lane L1 stays open and the removal by key waits for L1's lock; meanwhile the key gets a
   * head in a new lane L2 and an append behind it that stays open. L1's append commits: the removal
   * takes out the jobs of L1 only, reads again, waits for L2's lock and then takes out L2's jobs too.
   * Each wait is seen on the server before the next step (the lock the removal waits for is named by
   * its hash), or the removal has ended.
   */
  async function removalFollowsTheKeyToANewLane(
    remove: (jobs: JobStore) => Promise<number>,
    label: string,
  ): Promise<void> {
    const high = (n: number): StoredJobSpec => ({ ...fifo(n), priority: 'high' });
    await enqueueFor(0, [fifo(1)]);
    const lane1 = await laneOf(1);
    let removal: Promise<number> | undefined;
    let ended = false;
    let commitSecond: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      commitSecond = resolve;
    });
    let secondOpen: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      secondOpen = resolve;
    });
    let second: Promise<void> | undefined;
    await inTenant(`append-1-${label}`, async (jobs) => {
      await jobs.enqueue(fifo(2));
      removal = inTenant(`remove-${label}`, (remove_) => remove(remove_)).finally(() => {
        ended = true;
      });
      while (!ended && !(await waitsOnKeyLock(`remove-${label}`, lane1))) await pause(5);
      await enqueueFor(0, [high(3)]);
      second = inTenant(`append-2-${label}`, async (other) => {
        await other.enqueue(high(4));
        secondOpen();
        await gate;
      });
      await opened;
    });
    const lane2 = await laneOf(0);
    while (!ended && !(await waitsOnKeyLock(`remove-${label}`, lane2))) await pause(5);
    commitSecond();
    await second;
    expect(await removal).toBe(4);
    const [left] = await owner(
      async (client) =>
        (await client.query(`select count(*)::int as n from app.kw_jobs where key = 'chain'`)).rows,
    );
    expect(left).toEqual({ n: 0 });
  }

  test('a cancel by key that waited for one lane takes the jobs of a lane that appeared meanwhile too', async () => {
    await removalFollowsTheKeyToANewLane((jobs) => jobs.cancel('commands', 'chain'), 'cancel');
  });

  test('an erasure that waited for one lane takes the jobs of a lane that appeared meanwhile too', async () => {
    await removalFollowsTheKeyToANewLane(
      async (jobs) => (await jobs.purgeForPrincipals(['p'], ['commands'])).length,
      'purge',
    );
  });
});
