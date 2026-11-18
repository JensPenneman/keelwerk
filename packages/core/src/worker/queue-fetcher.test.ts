import { describe, expect, test, vi } from 'vitest';
import type { StoredJob } from '../storage/stored-job.ts';
import { queueFetcher } from './queue-fetcher.ts';
import type { QueueSource } from './queue-source.ts';
import type { takeBatch } from './take-batch.ts';

type Taken = Awaited<ReturnType<typeof takeBatch>>;

const seam = vi.hoisted(() => ({ take: undefined as Promise<unknown> | undefined }));
vi.mock('./take-batch.ts', () => ({
  takeBatch: () => seam.take ?? Promise.resolve({ jobs: [], skippedLanes: 0 }),
}));

const source = { namespace: { id: 'n1' } } as unknown as QueueSource;
const job = { id: 'job-1', queue: 'effects' } as unknown as StoredJob;

function fetcherOf(handler: (job: unknown) => Promise<void>) {
  const log = { warn: () => undefined, error: () => undefined };
  return queueFetcher({
    queue: 'effects',
    handler,
    options: { slots: 1, capabilitySets: [], revision: 1 },
    kernel: {
      sources: [source],
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
    take.resolve({ jobs: [job], skippedLanes: 0 } as unknown as Taken);
    await ticking;
    expect(left).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
});
