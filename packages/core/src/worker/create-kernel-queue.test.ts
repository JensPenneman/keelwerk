import { describe, expect, test, vi } from 'vitest';
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
function controlledFeed() {
  const waiting: JobWake[] = [];
  let release: (() => void) | undefined;
  let asked = 0;
  const watchers: (() => void)[] = [];
  return {
    level: 'notify' as const,
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

function kernelOver(feed: ReturnType<typeof controlledFeed>, namespaces: readonly string[]) {
  const adapter = { feed };
  return createKernelQueue({
    sources: namespaces.map(
      (id) =>
        ({
          namespace: { id },
          handle: { adapter, capabilities: { sql: false } },
          registry: {},
        }) as unknown as QueueSource,
    ),
    worker: 'p-1',
    clock: { now: () => Temporal.Instant.from('2026-03-01T08:00:00Z') },
    log,
    writer: {},
  } as unknown as Parameters<typeof createKernelQueue>[0]);
}

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
});
