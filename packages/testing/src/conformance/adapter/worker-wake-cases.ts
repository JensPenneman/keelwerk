import type { DataAdapter, Job, Logger, Unit } from '@keelwerk/core';
import { createKernelQueue, hybridClock } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { conformanceApp } from '../../fixtures/index.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { flushJobWakes } from './flush-job-wakes.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';
import { tapJobWakes } from './job-wake-tap.ts';

const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;
const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

/** The adapter with its takes counted per queue. */
function countingTakes(adapter: DataAdapter): { adapter: DataAdapter; takes: Map<string, number> } {
  const takes = new Map<string, number>();
  const counting = (unit: Unit): Unit => ({
    ...unit,
    jobs: {
      ...unit.jobs,
      take: (queue, worker, request) => {
        takes.set(queue, (takes.get(queue) ?? 0) + 1);
        return unit.jobs.take(queue, worker, request);
      },
    },
  });
  return {
    takes,
    adapter: {
      ...adapter,
      unit: (namespace, scope, fn, options) =>
        adapter.unit(namespace, scope, (unit) => fn(counting(unit)), options),
    },
  };
}

/**
 * The workers of a kernel queue over the adapter under test (9.5.6): a commit that made a job takeable
 * in one queue is followed by takes in that queue only, a job that a promotion made due is taken by the
 * sweep that promoted it, and a commit that cannot name its queues sweeps every queue. Takes are
 * counted, never timed: the cases wait until the workers have acted on every wake-up the commits made.
 */
export function workerWakeCases(
  subject: Pick<ConformanceSubject, 'run' | 'clock' | 'adapter' | 'namespace' | 'capabilities'>,
): void {
  const { enqueue, numbered } = jobStoreHelpers(subject);

  /** Workers on queues `a` and `b`; `ran` lists the queue of each job a handler received. */
  const start = async () => {
    const { clock } = subject;
    if (clock === undefined) throw new Error('the worker cases need a clock the suite can move');
    const counted = countingTakes(subject.adapter());
    const tap = tapJobWakes(counted.adapter.feed);
    // The workers' own clock stands still: their one-second poll never falls due inside a case.
    let pinned = clock.now();
    const queue = createKernelQueue({
      sources: [
        {
          namespace: subject.namespace(),
          // No framework track to wait for: the suite's tables are all there is.
          handle: {
            adapter: { ...counted.adapter, feed: { ...counted.adapter.feed, jobs: tap.jobs } },
            capabilities: { ...subject.capabilities(), sql: false },
          },
          registry: conformanceApp.registry,
        },
      ],
      worker: 'w-wake',
      clock: { now: () => pinned },
      log: silent,
      writer: { hybridClock: hybridClock('wake-test'), build: { id: 'b1', revision: 1 } },
      random: () => 0.999,
    });
    const taken: Job[] = [];
    const ran: string[] = [];
    const handler = async (job: Job): Promise<void> => {
      taken.push(job);
      ran.push(job.stored.queue);
    };
    const options = { slots: 4, capabilitySets: [''], revision: 100 } as const;
    const workers = await Promise.all([
      queue.work('a', handler, options),
      queue.work('b', handler, options),
    ]);
    const touch = async (marker: string): Promise<void> => {
      await enqueue([numbered(1, { queue: marker })]);
    };
    /** Waits until the workers have acted on every commit so far and are idle. */
    const settle = async (): Promise<void> => {
      await flushJobWakes(tap, touch);
      await queue.probe.idle();
    };
    await settle();
    counted.takes.clear();
    return {
      queue,
      takes: counted.takes,
      taken,
      ran,
      settle,
      now: () => clock.now(),
      /** Moves the adapter's clock and the workers' together. */
      advance: (milliseconds: number) => {
        clock.advance(milliseconds);
        pinned = pinned.add({ milliseconds });
      },
      stop: async () => {
        const deadline = Temporal.Now.instant();
        await Promise.all(workers.map((worker) => worker.drain(deadline)));
      },
    };
  };

  test('a commit that makes a job takeable in one queue causes takes in that queue only', async (t) => {
    if (subject.adapter().feed.level === 'poll') return t.skip();
    const workers = await start();
    try {
      await enqueue([numbered(1, { queue: 'a' })]);
      await workers.settle();
      expect(workers.takes.get('a')).toBeGreaterThan(0);
      expect(workers.takes.get('b') ?? 0).toBe(0);
      expect(workers.ran).toEqual(['a']);
    } finally {
      await workers.stop();
    }
  });

  test('a job that a promotion made due is taken by the sweep that promoted it', async (t) => {
    if (subject.adapter().feed.level === 'poll') return t.skip();
    const workers = await start();
    try {
      await enqueue([
        numbered(1, { queue: 'a', runAt: workers.now().add({ milliseconds: 1500 }) }),
      ]);
      await workers.settle();
      expect(workers.ran).toEqual([]);
      workers.advance(1600);
      workers.queue.probe.wake();
      await workers.queue.probe.idle();
      expect(workers.ran).toEqual(['a']);
    } finally {
      await workers.stop();
    }
  });

  test('a completion that gives back a group slot sweeps every queue', async (t) => {
    if (subject.adapter().feed.level === 'poll') return t.skip();
    const workers = await start();
    try {
      const grouped = (queue: string) => numbered(1, { queue, group: { id: 'g', concurrency: 1 } });
      await enqueue([grouped('a'), grouped('b')]);
      await workers.settle();
      // The group admits one of the two jobs, whichever queue's worker sweeps first.
      const [first] = workers.taken;
      expect(workers.ran).toHaveLength(1);
      if (first === undefined) throw new Error('no job was taken');
      await subject.run(namespaceScope, (unit) =>
        unit.jobs.complete(first.stored.attempt, 'w-wake', { kind: 'succeeded' }),
      );
      await workers.settle();
      expect([...workers.ran].sort()).toEqual(['a', 'b']);
    } finally {
      await workers.stop();
    }
  });

  test('a drain right after a commit runs its job; at rest it sweeps nothing on an adapter of one process, every queue on one of several', async (t) => {
    if (subject.adapter().feed.level === 'poll') return t.skip();
    const workers = await start();
    try {
      await enqueue([numbered(1, { queue: 'a' })]);
      workers.queue.probe.wake();
      await workers.queue.probe.idle();
      expect(workers.ran).toEqual(['a']);
      workers.takes.clear();
      workers.queue.probe.wake();
      await workers.queue.probe.idle();
      const { processes } = subject.capabilities();
      if (processes === 'single') {
        expect([...workers.takes]).toEqual([]);
      } else {
        expect(workers.takes.get('a')).toBeGreaterThan(0);
        expect(workers.takes.get('b')).toBeGreaterThan(0);
      }
    } finally {
      await workers.stop();
    }
  });
}
