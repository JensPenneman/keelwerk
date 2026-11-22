import type { JobOutcome, Unit, WireError } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { flushJobWakes } from './flush-job-wakes.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';
import { tapJobWakes } from './job-wake-tap.ts';

const { tenantA } = conformanceScopes;
const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;
const unavailable: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'down',
  retryable: true,
  requestId: 'r',
};

/**
 * The queues a commit made takeable (9.5.6, 14.3.9): `JobStore.readied` after the commit, and the
 * wake-ups of `ChangeFeedSource.jobs` that carry them, against every adapter. A feed that only polls
 * (a PostgreSQL adapter with `notify` off) names no queue and yields nothing: the workers' poll is the net.
 */
export function jobWakeCases(
  subject: Pick<ConformanceSubject, 'run' | 'read' | 'clock' | 'adapter' | 'namespace'>,
): void {
  const now = (): Temporal.Instant => subject.clock?.now() ?? Temporal.Now.instant();
  const { take, enqueue, finish, only, numbered } = jobStoreHelpers(subject);
  const inA = (n: number, over = {}) => numbered(n, { queue: 'a', ...over });

  /** What `readied` answers once the unit of `work` has committed. */
  const readiedBy = async (
    scope: Parameters<ConformanceSubject['run']>[0],
    work: (unit: Unit) => Promise<unknown>,
  ): Promise<readonly string[] | undefined> => {
    let committed: Unit | undefined;
    await subject.run(scope, async (unit) => {
      await work(unit);
      committed = unit;
    });
    if (committed === undefined) throw new Error('the unit did not run');
    return committed.jobs.readied();
  };
  const enqueuing = (...specs: ReturnType<typeof numbered>[]) =>
    readiedBy(tenantA, async (unit) => {
      for (const spec of specs) await unit.jobs.enqueue({ ...spec, scope: tenantA });
    });
  const completing = async (outcome: JobOutcome) => {
    await enqueue([inA(1)]);
    const job = only(await take('w1', { queue: 'a' }));
    return readiedBy(namespaceScope, (unit) => unit.jobs.complete(job.attempt, 'w1', outcome));
  };

  test('a due job puts its queue in readied and a scheduled one does not', async () => {
    expect(await enqueuing(inA(1))).toEqual(['a']);
    expect(await enqueuing(inA(2, { runAt: now().add({ hours: 1 }) }))).toEqual([]);
    expect([...((await enqueuing(inA(3), numbered(4, { queue: 'b' }))) ?? [])].sort()).toEqual([
      'a',
      'b',
    ]);
  });

  test('a promotion puts its queue in readied only when it moved a job', async () => {
    await enqueue([inA(1, { runAt: now().add({ milliseconds: 1000 }) })]);
    const promote = () => readiedBy(namespaceScope, (unit) => unit.jobs.promote('a', 10));
    expect(await promote()).toEqual([]);
    subject.clock?.advance(1100);
    expect(await promote()).toEqual(['a']);
    expect(await promote()).toEqual([]);
  });

  test('a completion gives its queue back: succeeded, retry and dead alike', async () => {
    expect(await completing({ kind: 'succeeded' })).toEqual(['a']);
    const at = now().add({ milliseconds: 1000 });
    expect(await completing({ kind: 'retry', at, error: unavailable })).toEqual(['a']);
    expect(await completing({ kind: 'dead', error: unavailable })).toEqual(['a']);
  });

  test('a release at a drain gives the queue of each released job back, and cannot name it for a group', async () => {
    const releasing = async (queue: string, over: object) => {
      await enqueue([numbered(1, { queue, ...over })]);
      const job = only(await take('w1', { queue }));
      return readiedBy(namespaceScope, (unit) => unit.jobs.release([job.attempt], 'w1'));
    };
    expect(await releasing('rel', {})).toEqual(['rel']);
    expect(await releasing('rel-g', { group: { id: 'rg', concurrency: 1 } })).toBeUndefined();
  });

  test('the end of a key head releases the next job of the key in the same queue', async () => {
    const chained = (n: number) =>
      inA(n, { key: { value: 'k', onConflict: 'append' }, ordering: 'fifo-per-key' });
    await enqueue([chained(1), chained(2)]);
    const head = only(await take('w1', { queue: 'a' }));
    expect(
      await readiedBy(namespaceScope, (unit) =>
        unit.jobs.complete(head.attempt, 'w1', { kind: 'succeeded' }),
      ),
    ).toEqual(['a']);
    expect(only(await take('w1', { queue: 'a' })).run).toMatchObject({ input: 2 });
  });

  const grouped = (queue: string, over = {}) =>
    numbered(1, { queue, group: { id: 'g', concurrency: 1 }, ...over });
  const groupOutcomes: readonly (readonly [string, () => JobOutcome])[] = [
    ['succeeded', () => ({ kind: 'succeeded' })],
    ['retry', () => ({ kind: 'retry', at: now().add({ milliseconds: 1000 }), error: unavailable })],
    ['dead', () => ({ kind: 'dead', error: unavailable })],
    ['failed', () => ({ kind: 'failed', error: unavailable })],
  ];

  test.each(groupOutcomes)(
    'a completion in a group, whose slot a job of another queue may wait for, names no queue: %s',
    async (_name, outcome) => {
      await enqueue([grouped('a')]);
      const job = only(await take('w1', { queue: 'a' }));
      expect(
        await readiedBy(namespaceScope, (unit) => unit.jobs.complete(job.attempt, 'w1', outcome())),
      ).toBeUndefined();
    },
  );

  test('the cancel of a running attempt in a group names no queue, as the cancel of one outside a group names its own', async () => {
    const cancelling = async (over: object) => {
      await enqueue([
        numbered(1, { queue: 'timers', key: { value: 'k', onConflict: 'replace' }, ...over }),
      ]);
      only(await take('w1', { queue: 'timers' }));
      return readiedBy(tenantA, (unit) => unit.jobs.cancel('timers', 'k'));
    };
    expect(await cancelling({})).toEqual(['timers']);
    expect(await cancelling({ group: { id: 'g', concurrency: 1 } })).toBeUndefined();
  });

  test('an enqueue that changes the limit of a group names no queue, one that keeps it names its own', async () => {
    const limited = (n: number, concurrency: number, over = {}) =>
      numbered(n, { queue: 'limit', group: { id: 'limit-g', concurrency }, ...over });
    const later = { runAt: now().add({ hours: 1 }) };
    // The first enqueue creates the group: no job waits for it yet.
    expect(await enqueuing(limited(1, 1))).toEqual(['limit']);
    expect(await enqueuing(limited(2, 1))).toEqual(['limit']);
    expect(await enqueuing(limited(3, 1, later))).toEqual([]);
    expect(await enqueuing(limited(4, 2))).toBeUndefined();
    expect(await enqueuing(limited(5, 3, later))).toBeUndefined();
    expect(await enqueuing(limited(6, 3, later))).toEqual([]);
  });

  test('an enqueue that changes the cap of a lane names its queue also for a job of later', async () => {
    const capped = (n: number, laneCap: number, over = {}) =>
      numbered(n, { queue: 'cap', laneCap, ...over });
    const later = { runAt: now().add({ hours: 1 }) };
    expect(await enqueuing(capped(1, 2, later))).toEqual([]);
    expect(await enqueuing(capped(2, 2, later))).toEqual([]);
    expect(await enqueuing(capped(3, 3, later))).toEqual(['cap']);
    expect(await enqueuing(capped(4, 3, later))).toEqual([]);
    expect(await enqueuing(capped(5, 4))).toEqual(['cap']);
  });

  test('an enqueue that changes only the weight of a lane names its queue also for a job of later', async () => {
    const weighted = (n: number, over = {}) => numbered(n, { queue: 'weight', ...over });
    const later = { runAt: now().add({ hours: 1 }) };
    expect(await enqueuing(weighted(1, { laneWeight: 2, ...later }))).toEqual([]);
    expect(await enqueuing(weighted(2, { laneWeight: 2, ...later }))).toEqual([]);
    expect(await enqueuing(weighted(3, { laneWeight: 3, ...later }))).toEqual(['weight']);
    // a spec without a weight leaves the lane's weight as it is and names nothing
    expect(await enqueuing(weighted(4, later))).toEqual([]);
    expect(await enqueuing(weighted(5, { laneWeight: 3, ...later }))).toEqual([]);
    expect(await enqueuing(weighted(6, { laneWeight: 4 }))).toEqual(['weight']);
  });

  test('a savepoint that fails takes back a changed limit and a changed cap', async () => {
    const refused = new Error('refused');
    const later = { runAt: now().add({ hours: 1 }) };
    await enqueue([
      numbered(1, { queue: 'undo', laneCap: 2, group: { id: 'undo-g', concurrency: 1 }, ...later }),
    ]);
    const changed = numbered(2, {
      queue: 'undo',
      laneCap: 3,
      group: { id: 'undo-g', concurrency: 2 },
      ...later,
    });
    expect(
      await readiedBy(tenantA, async (unit) => {
        await unit
          .nested(async (inner) => {
            await inner.jobs.enqueue({ ...changed, scope: tenantA });
            throw refused;
          })
          .catch((error: unknown) => {
            if (error !== refused) throw error;
          });
      }),
    ).toEqual([]);
  });

  test('a savepoint that fails takes back what it recorded, one that succeeds keeps it', async () => {
    const refused = new Error('refused');
    expect(
      await readiedBy(tenantA, async (unit) => {
        await unit
          .nested(async (inner) => {
            await inner.jobs.enqueue({ ...inA(1), scope: tenantA });
            throw refused;
          })
          .catch((error: unknown) => {
            if (error !== refused) throw error;
          });
      }),
    ).toEqual([]);
    expect(
      await readiedBy(tenantA, (unit) =>
        unit.nested((inner) => inner.jobs.enqueue({ ...inA(2), scope: tenantA })),
      ),
    ).toEqual(['a']);
  });

  test('a read-only unit makes nothing takeable', async () => {
    let seen: Unit | undefined;
    await subject.read(tenantA, async (unit) => {
      seen = unit;
    });
    expect(seen?.jobs.readied()).toEqual([]);
  });

  test('the feed starts with a wake-up that names no queue, then names the queues of each commit', async (t) => {
    const tap = tapJobWakes(subject.adapter().feed);
    const stop = new AbortController();
    const reading = (async () => {
      for await (const _ of tap.jobs([subject.namespace()], stop.signal)) {
        // The test reads what the tap received.
      }
    })();
    try {
      if (subject.adapter().feed.level === 'poll') return t.skip();
      expect(await tap.next()).toEqual({ namespace: subject.namespace().id });
      const touch = async (queue: string) => {
        await enqueue([numbered(1, { queue })]);
      };
      await flushJobWakes(tap, touch);
      await enqueue([inA(1)]);
      expect(await tap.next()).toEqual({ namespace: subject.namespace().id, queues: ['a'] });
      // A unit that appended events and made no job takeable wakes no worker: the next wake-up is b's.
      await subject.run(tenantA, async (unit) => {
        await unit.events.append([appendOf(1, [1])]);
      });
      await enqueue([numbered(2, { queue: 'b' })]);
      expect(await tap.next()).toEqual({ namespace: subject.namespace().id, queues: ['b'] });
      // A completion in a group names none of its queues: every queue is swept.
      await enqueue([numbered(3, { queue: 'c', group: { id: 'g', concurrency: 1 } })]);
      expect(await tap.next()).toEqual({ namespace: subject.namespace().id, queues: ['c'] });
      const job = only(await take('w1', { queue: 'c' }));
      await finish(job, 'w1', { kind: 'succeeded' });
      expect(await tap.next()).toEqual({ namespace: subject.namespace().id });
    } finally {
      stop.abort();
      await reading;
    }
  });
}
