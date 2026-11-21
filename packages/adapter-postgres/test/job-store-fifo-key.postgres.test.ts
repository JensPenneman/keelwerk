// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { JobStore, StorageScope, StoredJob, StoredJobSpec } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { eventHarness } from './support/event-harness.ts';
import { pause, spec, takeRequest, tenant } from './support/job-store-fixtures.ts';
import { lockLook } from './support/lock-look.ts';
import { taggedUnit } from './support/tagged-unit.ts';

const { adapter, clock, run, owner } = eventHarness('job_store_fifo', 16);
const namespaceScope: StorageScope = { level: 'namespace', reason: 'test' };
const { waiting: lockWait, untilEndedOrWaits: untilCompletionEndedOrWaits } = lockLook(owner);

const tagged = <T>(label: string, fn: (jobs: JobStore) => Promise<T>): Promise<T> =>
  taggedUnit(adapter(), clock, namespaceScope, `job-store:${label}`, async (unit) => fn(unit.jobs));

async function enqueueFor(n: number, jobs: readonly StoredJobSpec[]): Promise<void> {
  await run(tenant(n), async (unit) => {
    for (const job of jobs) await unit.jobs.enqueue({ ...job, scope: tenant(n) });
  });
}

describe('the end of a FIFO key head while a unit that appended to the key is open', () => {
  const fifo = (n: number): StoredJobSpec =>
    spec(n, { ordering: 'fifo-per-key', key: { value: 'chain', onConflict: 'append' } });

  /**
   * Opens a unit that appends the follower under the key, ends the head inside its window and
   * commits; `running` is a head taken before the unit opened, or undefined for a head taken inside
   * the window, before the append's insert or (`takeAfterInsert`) after it. The next take must
   * answer the follower.
   */
  async function appendWhileHeadEnds(
    running: StoredJob | undefined,
    label: string,
    takeAfterInsert = false,
  ): Promise<void> {
    let completion: Promise<boolean> | undefined;
    let completed = false;
    await taggedUnit(adapter(), clock, tenant(0), `job-store:append-${label}`, async (unit) => {
      // The insert holds `for key share` on the lane row. The take locks lane rows `for no key
      // update`, which does not conflict with that lock, so a take can come before the insert
      // (shape B) or after it (shape C) inside the window.
      const takeHead = async (): Promise<StoredJob | undefined> =>
        (await tagged(`take-head-${label}`, (jobs) => jobs.take('commands', 'w', takeRequest(1))))
          .jobs[0];
      const before = running ?? (takeAfterInsert ? undefined : await takeHead());
      await unit.jobs.enqueue(fifo(2));
      const head = before ?? (await takeHead());
      if (head === undefined) throw new Error('the head was not takeable');
      completion = tagged(`complete-${label}`, (jobs) =>
        jobs.complete(head.attempt, 'w', { kind: 'succeeded' }),
      ).finally(() => {
        completed = true;
      });
      await untilCompletionEndedOrWaits(() => completed, `complete-${label}`);
    });
    expect(await completion).toBe(true);
    const next = await tagged(`take-after-${label}`, (jobs) =>
      jobs.take('commands', 'w', takeRequest(5)),
    );
    expect(next.jobs.map((job) => job.run)).toEqual([{ action: 'a', input: 2 }]);
  }

  test('the head is running when the append opens and ends inside it: the appended job is released', async () => {
    await enqueueFor(0, [fifo(1)]);
    const [taken] = (
      await tagged('take-head-a', (jobs) => jobs.take('commands', 'w', takeRequest(1)))
    ).jobs;
    await appendWhileHeadEnds(taken, 'a');
  });

  test('the head is available when the append opens and a take inside it runs it to its end: the appended job is released', async () => {
    await enqueueFor(0, [fifo(1)]);
    await appendWhileHeadEnds(undefined, 'b');
  });

  test('the head is available when the append opens and a take after the insert of the append runs it to its end: the appended job is released', async () => {
    await enqueueFor(0, [fifo(1)]);
    await appendWhileHeadEnds(undefined, 'c', true);
  });

  const inTenant = <T>(label: string, fn: (jobs: JobStore) => Promise<T>): Promise<T> =>
    taggedUnit(adapter(), clock, tenant(0), `job-store:${label}`, async (unit) => fn(unit.jobs));

  test('a replace under the key and the end of the head wait for each other without a deadlock', async () => {
    await enqueueFor(0, [fifo(1), fifo(2)]);
    const [head] = (
      await tagged('take-head-r', (jobs) => jobs.take('commands', 'w', takeRequest(1)))
    ).jobs;
    if (head === undefined) throw new Error('the head was not takeable');
    let completion: Promise<boolean> | undefined;
    let completed = false;
    await inTenant('replace', async (jobs) => {
      await jobs.enqueue(
        spec(3, { ordering: 'fifo-per-key', key: { value: 'chain', onConflict: 'replace' } }),
      );
      completion = tagged('complete-r', (other) =>
        other.complete(head.attempt, 'w', { kind: 'succeeded' }),
      ).finally(() => {
        completed = true;
      });
      await untilCompletionEndedOrWaits(() => completed, 'complete-r');
    });
    expect(await completion).toBe(true);
    const next = await tagged('take-after-r', (jobs) => jobs.take('commands', 'w', takeRequest(5)));
    expect(next.jobs.map((job) => job.run)).toEqual([{ action: 'a', input: 3 }]);
  });

  test('an erasure and a replace under the key, both after the head row, do not deadlock', async () => {
    await enqueueFor(0, [fifo(1), fifo(2)]);
    let purged: Promise<unknown> | undefined;
    let replaced: Promise<unknown> | undefined;
    await owner(async (client) => {
      await client.query('begin');
      await client.query(
        `select id from app.kw_jobs where key = 'chain' and state = 'available' for update`,
      );
      purged = inTenant('purge', (jobs) => jobs.purgeForPrincipals(['p'], ['commands']));
      while ((await lockWait('purge')) === undefined) await pause(5);
      replaced = inTenant('replace2', (jobs) =>
        jobs.enqueue(
          spec(3, { ordering: 'fifo-per-key', key: { value: 'chain', onConflict: 'replace' } }),
        ),
      );
      while ((await lockWait('replace2')) === undefined) await pause(5);
      await client.query('rollback');
    });
    await Promise.all([purged, replaced]);
  });

  test('a cancel by key that starts while an append is open waits for it and cancels the appended job too', async () => {
    await enqueueFor(0, [fifo(1)]);
    let cancel: Promise<number> | undefined;
    let cancelled = false;
    await inTenant('append-c', async (jobs) => {
      await jobs.enqueue(fifo(2));
      cancel = tagged('cancel-c', (other) => other.cancel('commands', 'chain')).finally(() => {
        cancelled = true;
      });
      await untilCompletionEndedOrWaits(() => cancelled, 'cancel-c');
    });
    expect(await cancel).toBe(2);
    const [left] = await owner(
      async (client) =>
        (await client.query(`select count(*)::int as n from app.kw_jobs where key = 'chain'`)).rows,
    );
    expect(left).toEqual({ n: 0 });
    await enqueueFor(0, [fifo(3)]);
    const next = await tagged('take-after-c', (jobs) => jobs.take('commands', 'w', takeRequest(5)));
    expect(next.jobs.map((job) => job.run)).toEqual([{ action: 'a', input: 3 }]);
  });

  test('a cancel by key and the completion of the key running head, which waits for its row, do not deadlock', async () => {
    const timer = (n: number): StoredJobSpec =>
      spec(n, {
        queue: 'timers',
        ordering: 'fifo-per-key',
        key: { value: 'chain', onConflict: 'append' },
      });
    await enqueueFor(0, [timer(1), timer(2)]);
    const [head] = (await tagged('take-head-t', (jobs) => jobs.take('timers', 'w', takeRequest(1))))
      .jobs;
    if (head === undefined) throw new Error('the head was not takeable');
    let completion: Promise<boolean> | undefined;
    let cancel: Promise<number> | undefined;
    await owner(async (client) => {
      await client.query('begin');
      await client.query(`select id from app.kw_jobs where id = $1::bigint for update`, [head.id]);
      completion = tagged('complete-t', (jobs) =>
        jobs.complete(head.attempt, 'w', { kind: 'succeeded' }),
      );
      while ((await lockWait('complete-t')) === undefined) await pause(5);
      cancel = tagged('cancel-t', (jobs) => jobs.cancel('timers', 'chain'));
      while ((await lockWait('cancel-t')) === undefined) await pause(5);
      await client.query('rollback');
    });
    expect(await completion).toBe(true);
    expect(await cancel).toBe(1);
  });

  /** Runs a take inside the window of an open unit; answers the take's jobs and whether it waited. */
  async function takeInsideWindow(
    open: (jobs: JobStore) => Promise<void>,
    queue: string,
    label: string,
  ): Promise<{ jobs: readonly StoredJob[]; waited: boolean }> {
    let taking: Promise<readonly StoredJob[]> | undefined;
    let done = false;
    let waited = false;
    await inTenant(`open-${label}`, async (jobs) => {
      await open(jobs);
      taking = tagged(
        `take-${label}`,
        async (other) => (await other.take(queue, 'w2', takeRequest(5))).jobs,
      ).finally(() => {
        done = true;
      });
      waited = await untilCompletionEndedOrWaits(() => done, `take-${label}`);
    });
    return { jobs: (await taking) ?? [], waited };
  }

  test('a take hands out the head whose lease expired while an append under its key is open, and does not wait for the key', async () => {
    await enqueueFor(0, [fifo(1)]);
    await tagged('take-head-w', (jobs) => jobs.take('commands', 'w', takeRequest(1, 1000)));
    clock.advance(5000);
    await enqueueFor(1, [spec(9)]);
    const result = await takeInsideWindow(
      async (jobs) => void (await jobs.enqueue(fifo(2))),
      'commands',
      'w',
    );
    expect(result.waited).toBe(false);
    // The head returns to `available` and stays the key's head, so the open append, which holds
    // the key's lock, is no reason to leave it: a job that returns takes no key lock.
    expect(result.jobs.map((job) => (job.run as { input: number }).input).sort()).toEqual([1, 9]);
    const later = await tagged('take-later-w', (jobs) =>
      jobs.take('commands', 'w3', takeRequest(5)),
    );
    expect(later.jobs).toEqual([]);
    const [states] = await owner(
      async (client) =>
        (
          await client.query(
            `select count(*) filter (where state = 'running')::int as running,
              count(*) filter (where state = 'waiting')::int as waiting from app.kw_jobs where key = 'chain'`,
          )
        ).rows,
    );
    expect(states).toEqual({ running: 1, waiting: 1 });
  });

  test('a take does not wait behind an open cancel by key whose head lease expired', async () => {
    const timer = (n: number): StoredJobSpec =>
      spec(n, {
        queue: 'timers',
        ordering: 'fifo-per-key',
        key: { value: 'chain', onConflict: 'append' },
      });
    await enqueueFor(0, [timer(1), timer(2)]);
    await tagged('take-head-x', (jobs) => jobs.take('timers', 'w', takeRequest(1, 1000)));
    clock.advance(5000);
    const result = await takeInsideWindow(
      async (jobs) => void (await jobs.cancel('timers', 'chain')),
      'timers',
      'x',
    );
    expect(result.waited).toBe(false);
    expect(result.jobs).toEqual([]);
    const [left] = await owner(
      async (client) =>
        (await client.query(`select count(*)::int as n from app.kw_jobs where key = 'chain'`)).rows,
    );
    expect(left).toEqual({ n: 0 });
  });

  test('a take does not wait behind an open append when the head ends dead at its third lost lease', async () => {
    await enqueueFor(0, [fifo(1)]);
    for (let round = 0; round < 3; round += 1) {
      await tagged(`take-head-d${round}`, (jobs) =>
        jobs.take('commands', `w${round}`, takeRequest(1, 1000)),
      );
      clock.advance(5000);
    }
    await enqueueFor(1, [spec(9)]);
    const result = await takeInsideWindow(
      async (jobs) => void (await jobs.enqueue(fifo(2))),
      'commands',
      'd',
    );
    expect(result.waited).toBe(false);
    expect(result.jobs.map((job) => job.run)).toEqual([{ action: 'a', input: 9 }]);
    const first = await tagged('take-later-d1', (jobs) =>
      jobs.take('commands', 'w4', takeRequest(5)),
    );
    const second = await tagged('take-later-d2', (jobs) =>
      jobs.take('commands', 'w5', takeRequest(5)),
    );
    expect([...first.jobs, ...second.jobs].map((job) => job.run)).toEqual([
      { action: 'a', input: 2 },
    ]);
  });
});
