import { describe, expect, onTestFinished, test, vi } from 'vitest';
import type { Job } from '../jobs/job.ts';
import type { JobWake } from '../storage/change-feed-source.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import { createKernelQueue } from './create-kernel-queue.ts';
import type { QueueSource } from './queue-source.ts';

const seam = vi.hoisted(() => ({
  /** The answers of the next takes, in order; an empty list answers "nothing" every time. */
  answers: [] as unknown[],
  /** Every take, as `<queue>@<namespace>`. */
  takes: [] as string[],
}));
vi.mock('./take-batch.ts', () => ({
  takeBatch: (source: QueueSource, queue: string) => {
    seam.takes.push(`${queue}@${source.namespace.id}`);
    return Promise.resolve(seam.answers.shift() ?? { jobs: [], skippedLanes: 0, promoted: 0 });
  },
}));

const job = { id: 'job-1', queue: 'a' } as unknown as StoredJob;
const log = { debug: () => undefined, warn: () => undefined, error: () => undefined };

/** A feed whose wake-ups the test hands out, and that says when the kernel asks for the next one. */
function controlledFeed(level: 'notify' | 'poll' = 'notify') {
  const waiting: JobWake[] = [];
  let release: (() => void) | undefined;
  let asked = 0;
  const watchers: (() => void)[] = [];
  return {
    level,
    wake: () => (async function* () {})(),
    jobs: async function* (): AsyncGenerator<JobWake> {
      for (;;) {
        asked += 1;
        for (const watcher of watchers.splice(0)) watcher();
        while (waiting.length === 0) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        const next = waiting.shift();
        if (next !== undefined) yield next;
      }
    },
    push: (wake: JobWake) => {
      waiting.push(wake);
      release?.();
    },
    /** Settles once the kernel has asked for `count` wake-ups: it acted on the ones before. */
    asked: (count: number) =>
      new Promise<void>((resolve) => {
        const check = (): void => {
          if (asked >= count) resolve();
          else watchers.push(check);
        };
        check();
      }),
  };
}

function kernelOver(
  feed: ReturnType<typeof controlledFeed>,
  namespaces: readonly string[],
  extra: {
    /** The adapter's capabilities; default none that matter to the probe. */
    capabilities?: object;
    /** What the clock reads; default a clock that stands still. */
    now?: () => Temporal.Instant;
    /** More of the adapter than its feed. */
    adapter?: object;
  } = {},
) {
  const adapter = { feed, ...extra.adapter };
  return createKernelQueue({
    sources: namespaces.map(
      (id) =>
        ({
          namespace: { id },
          handle: { adapter, capabilities: { sql: false, ...extra.capabilities } },
          registry: {},
        }) as unknown as QueueSource,
    ),
    worker: 'p-1',
    clock: { now: extra.now ?? (() => Temporal.Instant.from('2026-03-01T08:00:00Z')) },
    log,
    writer: {},
  } as unknown as Parameters<typeof createKernelQueue>[0]);
}

/** One turn of the event loop: every promise the mocked takes resolve has run when it ends. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

const options = { slots: 2, capabilitySets: [''], revision: 1 };

describe('the kernel queue', () => {
  test('probe.wake sweeps each fetcher once, after the attended runs', async () => {
    seam.takes = [];
    seam.answers = [];
    const queue = kernelOver(controlledFeed(), ['n1']);
    const handler = vi.fn(async (_job: Job) => undefined);
    await queue.work('a', handler, options);
    await queue.probe.idle();
    seam.takes = [];
    // The run enqueues work, as a test's attended run does: the sweep that follows must find it.
    queue.attend(async () => {
      seam.answers.push({ jobs: [job], skippedLanes: 0, promoted: 0 });
    });
    queue.probe.wake();
    await queue.probe.idle();
    // One sweep: a take that finds the job, and the take that finds nothing more. A second sweep would add a third.
    expect(seam.takes).toEqual(['a@n1', 'a@n1']);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('a drain settles under the default fake timers of vitest, which fake setImmediate', async () => {
    seam.takes = [];
    seam.answers = [];
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const queue = kernelOver(controlledFeed(), ['n1']);
    await queue.work('a', async () => undefined, options);
    await queue.probe.idle();
    seam.takes = [];
    seam.answers.push({ jobs: [job], skippedLanes: 0, promoted: 0 });
    queue.probe.wake();
    await queue.probe.idle();
    expect(seam.takes).toEqual(['a@n1', 'a@n1']);
  });

  test('a job wake-up sweeps the fetchers of the queues it names, in its namespace; one without queues sweeps every fetcher of that namespace', async () => {
    seam.takes = [];
    seam.answers = [];
    const feed = controlledFeed();
    const queue = kernelOver(feed, ['n1', 'n2']);
    await queue.work('a', async () => undefined, options);
    await queue.work('b', async () => undefined, options);
    await feed.asked(1);
    await queue.probe.idle();
    seam.takes = [];
    feed.push({ namespace: 'n1', queues: ['a'] });
    await feed.asked(2);
    await queue.probe.idle();
    expect(seam.takes).toEqual(['a@n1']);
    seam.takes = [];
    feed.push({ namespace: 'n2' });
    await feed.asked(3);
    await queue.probe.idle();
    expect([...seam.takes].sort()).toEqual(['a@n2', 'b@n2']);
  });

  describe('a drain on a source of one process whose feed notifies', () => {
    const single = { processes: 'single' } as const;
    const startOf = async (now?: () => Temporal.Instant) => {
      seam.takes = [];
      seam.answers = [];
      const feed = controlledFeed();
      const queue = kernelOver(feed, ['n1', 'n2'], { capabilities: single, ...(now && { now }) });
      await queue.work('a', async () => undefined, options);
      await queue.probe.idle();
      seam.takes = [];
      return { feed, queue };
    };

    test("sweeps nothing when every fetcher came to rest at the clock's reading", async () => {
      const { queue } = await startOf();
      queue.probe.wake();
      await queue.probe.idle();
      expect(seam.takes).toEqual([]);
    });

    test('sweeps every namespace of a fetcher when the clock moved since its last sweep came to rest', async () => {
      let now = Temporal.Instant.from('2026-03-01T08:00:00Z');
      const { queue } = await startOf(() => now);
      now = now.add({ milliseconds: 1 });
      queue.probe.wake();
      await queue.probe.idle();
      expect([...seam.takes].sort()).toEqual(['a@n1', 'a@n2']);
    });

    test('sweeps the queue of a wake-up pushed just before it', async () => {
      const { feed, queue } = await startOf();
      feed.push({ namespace: 'n1', queues: ['a'] });
      queue.probe.wake();
      await queue.probe.idle();
      expect(seam.takes).toEqual(['a@n1']);
    });

    test('sweeps a fetcher whose last sweep did not come to rest', async () => {
      seam.takes = [];
      // Every take skips a lane: the sweep retakes thrice and ends with lanes still locked.
      seam.answers = Array.from({ length: 4 }, () => ({ jobs: [], skippedLanes: 1, promoted: 0 }));
      const queue = kernelOver(controlledFeed(), ['n1'], { capabilities: single });
      await queue.work('a', async () => undefined, options);
      await queue.probe.idle();
      expect(seam.takes).toEqual(['a@n1', 'a@n1', 'a@n1', 'a@n1']);
      seam.takes = [];
      queue.probe.wake();
      await queue.probe.idle();
      expect(seam.takes).toEqual(['a@n1']);
    });
  });

  test.each([
    ['serves more than one process', { processes: 'network' }, 'notify'],
    ['polls', { processes: 'single' }, 'poll'],
  ] as const)(
    'a drain wakes every fetcher when the source %s',
    async (_name, capabilities, level) => {
      seam.takes = [];
      seam.answers = [];
      const queue = kernelOver(controlledFeed(level), ['n1', 'n2'], { capabilities });
      await queue.work('a', async () => undefined, options);
      await queue.probe.idle();
      seam.takes = [];
      queue.probe.wake();
      await queue.probe.idle();
      expect([...seam.takes].sort()).toEqual(['a@n1', 'a@n2']);
    },
  );

  test('a slot freed in a full fetcher sweeps that fetcher before the probe is quiet, and no other fetcher', async () => {
    seam.takes = [];
    seam.answers = [{ jobs: [job], skippedLanes: 0, promoted: 0 }];
    const queue = kernelOver(controlledFeed(), ['n1']);
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const handler = vi.fn(async (_job: Job) => {
      started.resolve();
      if (handler.mock.calls.length === 1) await release.promise;
    });
    await queue.work('a', handler, { ...options, slots: 1 });
    await started.promise;
    await queue.work('b', async () => undefined, options);
    // Every sweep so far has ended: the slot of `a` is full and `b` is at rest.
    await turn();
    seam.takes = [];
    seam.answers = [{ jobs: [{ ...job, id: 'job-2' }], skippedLanes: 0, promoted: 0 }];
    release.resolve();
    await queue.probe.idle();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(seam.takes).not.toContain('b@n1');
  });

  test('Job.heartbeat() renews the lease and sweeps no fetcher', async () => {
    seam.takes = [];
    seam.answers = [
      { jobs: [{ ...job, attempt: { jobId: 'job-1', attempt: 1 } }], skippedLanes: 0, promoted: 0 },
    ];
    const renewed = Promise.withResolvers<void>();
    const unit = (_namespace: unknown, _scope: unknown, run: (unit: object) => unknown) =>
      run({
        jobs: {
          heartbeat: (attempts: readonly unknown[]) => {
            renewed.resolve();
            return Promise.resolve(attempts);
          },
        },
      });
    const queue = kernelOver(controlledFeed(), ['n1', 'n2'], {
      adapter: { unit, placementId: 'p' },
    });
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<Job>();
    await queue.work(
      'a',
      async (held) => {
        started.resolve(held);
        await release.promise;
      },
      options,
    );
    const held = await started.promise;
    await queue.work('b', async () => undefined, options);
    // Every sweep so far has ended.
    await turn();
    seam.takes = [];
    held.heartbeat();
    await renewed.promise;
    await turn();
    release.resolve();
    await queue.probe.idle();
    expect(seam.takes).toEqual([]);
  });
});
