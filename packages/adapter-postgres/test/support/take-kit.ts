// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { JobStore, StorageScope, StoredJob, StoredJobSpec } from '@keelwerk/core';
import type { EventHarness } from './event-harness.ts';
import { spec, takeRequest, tenant } from './job-store-fixtures.ts';
import { lockLook } from './lock-look.ts';
import { taggedUnit } from './tagged-unit.ts';

/** What a take under test did: its promise, and whether a look saw it wait for a lock. */
export interface Observed<T> {
  readonly promise: Promise<T>;
  readonly waited: boolean;
}

/**
 * The helpers of the never-waits cases of a take over one `eventHarness`: units tagged for the
 * look at the server, the holders (a unit, a counter row, the rows of jobs in a state), and the
 * answers a take gives.
 */
export function takeKit(harness: Pick<EventHarness, 'adapter' | 'clock' | 'run' | 'owner'>) {
  const { adapter, clock, run, owner } = harness;
  const namespaceScope: StorageScope = { level: 'namespace', reason: 'test' };
  const { untilEndedOrWaits } = lockLook(owner);
  const tagged = <T>(label: string, fn: (jobs: JobStore) => Promise<T>): Promise<T> =>
    taggedUnit(adapter(), clock, namespaceScope, `job-store:${label}`, async (unit) =>
      fn(unit.jobs),
    );
  const inTenant = <T>(label: string, fn: (jobs: JobStore) => Promise<T>): Promise<T> =>
    taggedUnit(adapter(), clock, tenant(0), `job-store:${label}`, async (unit) => fn(unit.jobs));

  const fifo = (n: number, over: Partial<StoredJobSpec> = {}): StoredJobSpec =>
    spec(n, { ordering: 'fifo-per-key', key: { value: 'chain', onConflict: 'append' }, ...over });
  const group = (concurrency: number) => ({ id: 'g', concurrency });
  const inputOf = (job: StoredJob): number => (job.run as { input: number }).input;
  const inputs = (jobs: readonly StoredJob[]): number[] => jobs.map(inputOf).sort();

  const takeAll = (label: string): Promise<{ jobs: readonly StoredJob[]; skippedLanes: number }> =>
    tagged(label, (jobs) => jobs.take('commands', 'w2', takeRequest(5)));

  /** A take unit as the fetcher runs it: the promotion first, then the take, in one unit. */
  const promoteAndTake = (label: string) =>
    tagged(label, async (jobs) => {
      const promoted = await jobs.promote('commands', 100);
      return { promoted, ...(await jobs.take('commands', 'w2', takeRequest(5))) };
    });

  async function enqueueFor(jobs: readonly StoredJobSpec[]): Promise<void> {
    await run(tenant(0), async (unit) => {
      for (const job of jobs) await unit.jobs.enqueue(job);
    });
  }

  /** Takes the jobs with a 1 s lease and lets the lease end, `rounds` times: a job has then lost `rounds - 1` leases. */
  async function expireLeases(rounds: number): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
      await tagged(`take-lease-${round}`, (jobs) =>
        jobs.take('commands', 'w', takeRequest(5, 1000)),
      );
      clock.advance(5000);
    }
  }

  /**
   * Starts `work` and goes on when it has ended or a look has seen it wait; the caller ends its holder
   * and then awaits `promise`. A holder that sees `waited` ends and fails the case.
   */
  async function observe<T>(label: string, work: () => Promise<T>): Promise<Observed<T>> {
    let ended = false;
    const promise = work().finally(() => {
      ended = true;
    });
    return { promise, waited: await untilEndedOrWaits(() => ended, label) };
  }

  async function laneId(): Promise<string> {
    const [lane] = await owner(
      async (client) => (await client.query(`select id::text as id from app.kw_job_lanes`)).rows,
    );
    return String(lane?.id);
  }

  /** A transaction of the owner that holds one counter row of the lane `for update` until `inside` returns. */
  async function holdingCount(
    kind: 'done' | 'enqueued',
    inside: () => Promise<void>,
    lane?: string,
  ): Promise<void> {
    const held = lane ?? (await laneId());
    await owner(async (client) => {
      await client.query('begin');
      try {
        await client.query(
          `select 1 from app.kw_job_lane_counts where lane_id = $1::bigint and kind = $2 for update`,
          [held, kind],
        );
        await inside();
      } finally {
        await client.query('rollback');
      }
    });
  }

  /** A transaction of the owner that holds the rows of the jobs in `state` `for update` until `inside` returns. */
  async function holdingJobRows(state: string, inside: () => Promise<void>): Promise<void> {
    await owner(async (client) => {
      await client.query('begin');
      try {
        await client.query(`select id from app.kw_jobs where state = $1 for update`, [state]);
        await inside();
      } finally {
        await client.query('rollback');
      }
    });
  }

  const stateOf = async (key: string): Promise<readonly Record<string, unknown>[]> =>
    owner(
      async (client) =>
        (
          await client.query(
            `select state, lost_leases from app.kw_jobs where key = $1 order by id`,
            [key],
          )
        ).rows,
    );

  const rowsOf = async (sql: string): Promise<readonly Record<string, unknown>[]> =>
    owner(async (client) => (await client.query(sql)).rows);
  return {
    tagged,
    inTenant,
    fifo,
    group,
    inputs,
    takeAll,
    promoteAndTake,
    enqueueFor,
    expireLeases,
    observe,
    holdingCount,
    holdingJobRows,
    stateOf,
    rowsOf,
  };
}
