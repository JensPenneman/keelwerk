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
  /** How many of the next takes the store refuses. */
  refused: 0,
}));
vi.mock('./take-batch.ts', () => ({
  takeBatch: (source: QueueSource) => {
    seam.swept.push(source.namespace.id);
    if (seam.refused > 0) {
      seam.refused -= 1;
      return Promise.reject(new Error('the database is away'));
    }
    return (
      seam.take ??
      Promise.resolve(seam.answers.shift() ?? { jobs: [], skippedLanes: 0, promoted: 0 })
    );
  },
}));

const ended = vi.hoisted(() => ({ jobs: [] as string[], failure: undefined as Error | undefined }));
// Conformance: queue-scenario-receipt-cases (the real unit that fails the receipt, on every adapter).
vi.mock('./settle-exhausted-job.ts', () => ({
  settleExhaustedJob: (_context: unknown, stored: { id: string }) => {
    ended.jobs.push(stored.id);
    return ended.failure === undefined ? Promise.resolve() : Promise.reject(ended.failure);
  },
}));

const source = { namespace: { id: 'n1' } } as unknown as QueueSource;
const other = { namespace: { id: 'n2' } } as unknown as QueueSource;
const job = {
  id: 'job-1',
  queue: 'effects',
  attempt: { jobId: 'job-1', attempt: 1 },
} as unknown as StoredJob;

function fetcherOf(
  handler: (job: unknown) => Promise<void>,
  sources = [source],
  ready: () => Promise<boolean> = async () => true,
  random?: () => number,
) {
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
      ...(random === undefined ? {} : { random }),
    },
    held: new Map(),
    readiness: { ready, recheck: () => undefined },
    hooks: {
      took: () => undefined,
      settled: () => undefined,
      changed: () => undefined,
      tick: () => undefined,
    },
  } as unknown as Parameters<typeof queueFetcher>[0]);
}

describe('the fetcher of a queue that drains while a take is in flight', () => {
  beforeEach(() => {
    seam.take = undefined;
    seam.answers = [];
    seam.swept = [];
  });

  test('starts none of the taken jobs, gives their attempts back, and the drain answers only after that', async () => {
    const take = Promise.withResolvers<Taken>();
    seam.take = take.promise;
    const released: unknown[] = [];
    const releasing = {
      handle: {
        adapter: {
          placementId: 'main',
          unit: async (_: unknown, __: unknown, fn: (unit: unknown) => Promise<unknown>) =>
            fn({
              jobs: {
                release: async (attempts: unknown[]) => {
                  released.push(...attempts);
                  return attempts;
                },
              },
            }),
        },
      },
      namespace: { id: 'n1' },
    } as unknown as QueueSource;
    const handler = vi.fn(async () => undefined);
    const fetcher = fetcherOf(handler, [releasing]);
    const ticking = fetcher.tick(Temporal.Now.instant());
    // The take is waiting on the store when the drain begins, at a deadline that has passed already:
    // the drain still waits for the take and for the release of its batch, so nothing of the worker
    // runs on after the drain has answered.
    let drained = false;
    const draining = fetcher.drain(Temporal.Now.instant()).then((answer) => {
      drained = true;
      return answer;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(drained).toBe(false);
    expect(released).toEqual([]);
    take.resolve({ jobs: [job], skippedLanes: 0, promoted: 0 } as unknown as Taken);
    const left = await draining;
    expect(released).toEqual([job.attempt]);
    await ticking;
    expect(left).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    // Conformance: job-store-release-cases (a released attempt is taken again under its number).
  });

  test('a fetcher that began to drain takes nothing again, even for a wake or a promotion', async () => {
    seam.answers = [{ jobs: [job], skippedLanes: 0, promoted: 1 }];
    const fetcher = fetcherOf(async () => undefined);
    await fetcher.drain(Temporal.Now.instant());
    fetcher.wake();
    await fetcher.tick(Temporal.Now.instant());
    expect(seam.swept).toEqual([]);
  });
});

describe('the fetcher with a job whose leases were lost too often', () => {
  beforeEach(() => {
    seam.take = undefined;
    seam.answers = [{ jobs: [{ ...job, leasesExhausted: true }], skippedLanes: 0, promoted: 0 }];
    seam.swept = [];
    ended.jobs = [];
    ended.failure = undefined;
  });

  test('ends the job and never runs its handler', async () => {
    const handler = vi.fn(async () => undefined);
    const fetcher = fetcherOf(handler);
    await fetcher.tick(Temporal.Now.instant());
    await fetcher.drain(Temporal.Now.instant().add({ seconds: 5 }));
    expect(ended.jobs).toEqual(['job-1']);
    expect(handler).not.toHaveBeenCalled();
  });

  // The store hands the job out again after its lease, at any number of lost leases: the
  // conformance case "a command job whose taker never ends it is handed out again however often
  // its leases are lost" proves that, and worker-end-unit.test.ts the retries of the real end unit.
  test('a unit that fails leaves the job to its lease: the handler still never runs', async () => {
    ended.failure = new Error('the store is gone');
    const handler = vi.fn(async () => undefined);
    const fetcher = fetcherOf(handler);
    await fetcher.tick(Temporal.Now.instant());
    await fetcher.drain(Temporal.Now.instant().add({ seconds: 5 }));
    expect(ended.jobs).toEqual(['job-1']);
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
    // A store may count promoted jobs only when its unit commits, so the take that promoted them sees none.
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

  describe('seenAt', () => {
    test('is kept by a sweep that took and then found nothing, and lost by one that left a lane skipped', async () => {
      const fetcher = fetcherOf(async () => undefined);
      const at = Temporal.Now.instant();
      seam.answers = [{ jobs: [], skippedLanes: 0, promoted: 1 }];
      await fetcher.tick(at);
      expect(fetcher.seenAt).toEqual(at);
      // Every take skips a lane: the sweep retakes thrice and ends with lanes still locked.
      seam.answers = Array.from({ length: 4 }, () => ({ jobs: [], skippedLanes: 1, promoted: 0 }));
      fetcher.wake();
      await fetcher.tick(at);
      expect(fetcher.seenAt).toBeUndefined();
    });

    test('is unknown while a source is not ready, and known again once it is', async () => {
      let ready = false;
      const fetcher = fetcherOf(
        async () => undefined,
        [source],
        async () => ready,
      );
      const at = Temporal.Now.instant();
      await fetcher.tick(at);
      expect(fetcher.seenAt).toBeUndefined();
      ready = true;
      fetcher.wake();
      await fetcher.tick(at);
      expect(fetcher.seenAt).toEqual(at);
    });

    test('is unknown after a sweep that threw', async () => {
      const fetcher = fetcherOf(async () => undefined);
      const at = Temporal.Now.instant();
      await fetcher.tick(at);
      seam.take = Promise.reject(new Error('the store is gone'));
      fetcher.wake();
      await fetcher.tick(at);
      expect(fetcher.seenAt).toBeUndefined();
    });
  });
});

describe('the polls of a fetcher whose store refuses its takes', () => {
  beforeEach(() => {
    seam.take = undefined;
    seam.answers = [];
    seam.swept = [];
    seam.refused = 0;
  });

  test('the poll after a second failure in a row comes after the second pause of the policy', async () => {
    seam.refused = 2;
    const fetcher = fetcherOf(
      async () => undefined,
      [source],
      async () => true,
      () => 0.5,
    );
    const start = Temporal.Instant.from('2026-03-01T08:00:00Z');
    const at = async (milliseconds: number): Promise<number> => {
      await fetcher.tick(start.add({ milliseconds }));
      return seam.swept.length;
    };
    // The first failure: the pause is the one of an ordinary poll, a second.
    expect(await at(0)).toBe(1);
    expect(await at(999)).toBe(1);
    expect(await at(1000)).toBe(2);
    // The second failure in a row: two seconds.
    expect(await at(2999)).toBe(2);
    expect(await at(3000)).toBe(3);
    // The sweep that succeeded starts the count again.
    expect(await at(3999)).toBe(3);
    expect(await at(4000)).toBe(4);
  });

  test('a failed sweep of one named namespace leaves the poll of every namespace where it was', async () => {
    const fetcher = fetcherOf(
      async () => undefined,
      [source, other],
      async () => true,
      () => 0.5,
    );
    const start = Temporal.Instant.from('2026-03-01T08:00:00Z');
    const at = async (milliseconds: number): Promise<string> => {
      await fetcher.tick(start.add({ milliseconds }));
      return seam.swept.join(' ');
    };
    // The first poll sweeps both namespaces and sets the next one a second later.
    expect(await at(0)).toBe('n1 n2');
    // A wake names n1 and its sweep fails: the poll of n1 and n2 was not part of it.
    fetcher.wake('n1');
    seam.refused = 1;
    expect(await at(500)).toBe('n1 n2 n1');
    // The poll is still due at one second, though the failed sweep came at 500 ms; it sweeps both.
    expect(await at(999)).toBe('n1 n2 n1');
    expect(await at(1000)).toBe('n1 n2 n1 n1 n2');
  });
});
