import { expect, onTestFinished, test, vi } from 'vitest';
import type { JobWake } from '../storage/change-feed-source.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import { createKernelQueue } from './create-kernel-queue.ts';
import type { QueueSource } from './queue-source.ts';

const seam = vi.hoisted(() => ({ answers: [] as unknown[] }));
vi.mock('./take-batch.ts', () => ({
  takeBatch: () =>
    Promise.resolve(seam.answers.shift() ?? { jobs: [], skippedLanes: 0, promoted: 0 }),
}));

const job = {
  id: 'job-1',
  queue: 'a',
  attempt: { jobId: 'job-1', attempt: 1 },
} as unknown as StoredJob;
const start = Temporal.Instant.from('2026-03-01T08:00:00Z');
const log = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};

/** One turn of the event loop: every promise the mocked takes resolve has run when it ends. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A queue holding one attempt whose handler waits, over a store whose heartbeat runs `heartbeat`;
 * the draw of every jitter is one half, and the clock stands where the test puts it.
 */
async function holding(heartbeat: () => Promise<unknown>) {
  seam.answers = [{ jobs: [job], skippedLanes: 0, promoted: 0 }];
  let now = start;
  const renewals = vi.fn(heartbeat);
  const unit = (_namespace: unknown, _scope: unknown, run: (unit: object) => unknown) =>
    run({ jobs: { heartbeat: renewals } });
  const feed = {
    level: 'notify',
    wake: () => (async function* () {})(),
    // A feed that never wakes: only the test's probe drives the queue.
    jobs: async function* (): AsyncGenerator<JobWake> {
      await new Promise<never>(() => undefined);
    },
  };
  const queue = createKernelQueue({
    sources: [
      {
        namespace: { id: 'n1' },
        handle: { adapter: { feed, unit, placementId: 'p' }, capabilities: { sql: false } },
        registry: {},
      } as unknown as QueueSource,
    ],
    worker: 'p-1',
    clock: { now: () => now },
    log,
    writer: {},
    random: () => 0.5,
  } as unknown as Parameters<typeof createKernelQueue>[0]);
  const release = Promise.withResolvers<void>();
  onTestFinished(async () => {
    release.resolve();
    await queue.probe.idle();
  });
  await queue.work('a', () => release.promise, { slots: 2, capabilitySets: [''], revision: 1 });
  await turn();
  return {
    queue,
    renewals,
    at: (milliseconds: number) => {
      now = start.add({ milliseconds });
    },
  };
}

test('a failed renewal is not asked again before the pause of the policy has passed', async () => {
  const away = await holding(() => Promise.reject(new Error('the database is away')));
  away.at(10_000);
  away.queue.probe.wake();
  await turn();
  expect(away.renewals).toHaveBeenCalledTimes(1);
  // The same reading, and one millisecond before the pause (1000 ms at a draw of one half) is over.
  away.queue.probe.wake();
  await turn();
  away.at(10_999);
  away.queue.probe.wake();
  await turn();
  expect(away.renewals).toHaveBeenCalledTimes(1);
  away.at(11_000);
  away.queue.probe.wake();
  await turn();
  expect(away.renewals).toHaveBeenCalledTimes(2);
  // The second failure in a row waits twice as long.
  away.at(12_999);
  away.queue.probe.wake();
  await turn();
  expect(away.renewals).toHaveBeenCalledTimes(2);
  away.at(13_000);
  away.queue.probe.wake();
  await turn();
  expect(away.renewals).toHaveBeenCalledTimes(3);
});

test('a renewal in flight does not make the tick spin', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const scheduled = vi.spyOn(globalThis, 'setTimeout');
  const answer = Promise.withResolvers<unknown>();
  const pending = await holding(() => answer.promise);
  try {
    pending.at(10_000);
    await vi.advanceTimersByTimeAsync(1000);
    // The renewal asked at that tick has not answered; the next tick is a second away, not now.
    expect(pending.renewals).toHaveBeenCalledTimes(1);
    expect(scheduled.mock.calls.at(-1)?.[1]).toBe(1000);
  } finally {
    answer.resolve([]);
  }
});

test('a tick that finds a failed renewal still in its pause waits for the pause, it does not spin', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const scheduled = vi.spyOn(globalThis, 'setTimeout');
  const away = await holding(() => Promise.reject(new Error('the database is away')));
  away.at(10_000);
  // The first tick asks and fails; the second, a second later on the timer, finds the pause not
  // over.
  await vi.advanceTimersByTimeAsync(1000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(away.renewals).toHaveBeenCalledTimes(1);
  // The pause ends at 11 000 ms and the clock reads 10 000: the next tick is a second away, not
  // now.
  expect(scheduled.mock.calls.at(-1)?.[1]).toBe(1000);
});

test('a renewal that succeeds starts the count of failures again', async () => {
  let failing = true;
  const store = await holding(() =>
    failing ? Promise.reject(new Error('away')) : Promise.resolve([{ jobId: 'job-1', attempt: 1 }]),
  );
  const askedAt = async (milliseconds: number): Promise<number> => {
    store.at(milliseconds);
    store.queue.probe.wake();
    await turn();
    return store.renewals.mock.calls.length;
  };
  expect(await askedAt(10_000)).toBe(1);
  // The pause after the first failure is a second; the renewal at 11 000 ms succeeds.
  failing = false;
  expect(await askedAt(11_000)).toBe(2);
  // Renewed at 11 000 ms: the next is a heartbeat later, with no pause left over from the failure.
  expect(await askedAt(20_999)).toBe(2);
  failing = true;
  expect(await askedAt(21_000)).toBe(3);
  // A failure after a success is the first again: a pause of a second, not of two.
  expect(await askedAt(21_999)).toBe(3);
  expect(await askedAt(22_000)).toBe(4);
});
