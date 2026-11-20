import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { StoredJob } from '../storage/stored-job.ts';
import { queueFetcher } from './queue-fetcher.ts';
import type { QueueSource } from './queue-source.ts';
import type { takeBatch } from './take-batch.ts';

type Taken = Awaited<ReturnType<typeof takeBatch>>;

const seam = vi.hoisted(() => ({
  take: undefined as Promise<unknown> | undefined,
  /** The answers of the next takes, in order; an empty list answers "nothing" every time. */
  answers: [] as unknown[],
  /** The namespace of every take. */
  swept: [] as string[],
}));
vi.mock('./take-batch.ts', () => ({
  takeBatch: (source: QueueSource) => {
    seam.swept.push(source.namespace.id);
    return (
      seam.take ??
      Promise.resolve(seam.answers.shift() ?? { jobs: [], skippedLanes: 0, promoted: 0 })
    );
  },
}));

const source = { namespace: { id: 'n1' } } as unknown as QueueSource;
const other = { namespace: { id: 'n2' } } as unknown as QueueSource;
const job = { id: 'job-1', queue: 'effects' } as unknown as StoredJob;

function fetcherOf(handler: (job: unknown) => Promise<void>, sources = [source]) {
  const log = { warn: () => undefined, error: () => undefined };
  return queueFetcher({
    queue: 'effects',
    handler,
    options: { slots: 1, capabilitySets: [], revision: 1 },
    kernel: {
      sources,
      worker: 'p-1',
      clock: { now: () => Temporal.Now.instant() },
      log,
      writer: {},
    },
    held: new Map(),
    readiness: { ready: async () => true, recheck: () => undefined },
    hooks: {
      took: () => undefined,
      settled: () => undefined,
      changed: () => undefined,
      wake: () => undefined,
    },
  } as unknown as Parameters<typeof queueFetcher>[0]);
}

describe('the fetcher of a queue that drains while a take is in flight', () => {
  test('starts none of the taken jobs: their leases expire and the handler never runs', async () => {
    const take = Promise.withResolvers<Taken>();
    seam.take = take.promise;
    const handler = vi.fn(async () => undefined);
    const fetcher = fetcherOf(handler);
    const ticking = fetcher.tick(Temporal.Now.instant());
    // The take is waiting on the store when the drain begins.
    const left = await fetcher.drain(Temporal.Now.instant());
    take.resolve({ jobs: [job], skippedLanes: 0, promoted: 0 } as unknown as Taken);
    await ticking;
    expect(left).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('the sweep of a fetcher', () => {
  beforeEach(() => {
    seam.take = undefined;
    seam.answers = [];
    seam.swept = [];
  });

  test('a take that promoted due jobs is followed at once by another take, which starts them', async () => {
    // The store counts promoted jobs when the unit commits, so the take that promoted them sees none.
    seam.answers = [
      { jobs: [], skippedLanes: 0, promoted: 1 },
      { jobs: [job], skippedLanes: 0, promoted: 0 },
    ];
    const handler = vi.fn(async () => undefined);
    await fetcherOf(handler).tick(Temporal.Now.instant());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('a wake that names a namespace sweeps that namespace; the poll sweeps every namespace', async () => {
    const fetcher = fetcherOf(async () => undefined, [source, other]);
    const at = Temporal.Now.instant();
    // The first tick is a poll (and a wake of everything).
    await fetcher.tick(at);
    expect([...seam.swept].sort()).toEqual(['n1', 'n2']);
    seam.swept = [];
    fetcher.wake('n2');
    await fetcher.tick(at);
    expect(seam.swept).toEqual(['n2']);
    seam.swept = [];
    fetcher.wake();
    await fetcher.tick(at);
    expect([...seam.swept].sort()).toEqual(['n1', 'n2']);
    // No wake and no poll due: nothing is swept; a poll that falls due sweeps both.
    seam.swept = [];
    await fetcher.tick(at);
    expect(seam.swept).toEqual([]);
    await fetcher.tick(at.add({ seconds: 2 }));
    expect([...seam.swept].sort()).toEqual(['n1', 'n2']);
  });
});
