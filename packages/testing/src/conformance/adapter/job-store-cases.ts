import type { JobOutcome, StoredJob, WireError } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';
import { jobStorePendingCases } from './job-store-pending-cases.ts';
import { jobStoreTenantCases } from './job-store-tenant-cases.ts';

const { tenantA, tenantB } = conformanceScopes;
const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const unavailable: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'down',
  retryable: true,
  requestId: 'r',
};
const succeeded: JobOutcome = { kind: 'succeeded' };

/**
 * The queue scenarios of 14.10 that one connection can run (keys, fair order, caps, groups, FIFO per
 * key, retries, leases, fencing, dead letters, statistics and promotion), against the job store of
 * every adapter. The concurrency of takers is a case of the PostgreSQL suite.
 */
export function jobStoreCases(subject: Pick<ConformanceSubject, 'run' | 'clock'>): void {
  const now = (): Temporal.Instant => subject.clock?.now() ?? Temporal.Now.instant();
  /** Moves time on: the target's clock when it has one, real time otherwise. */
  const wait = async (ms: number): Promise<void> => {
    if (subject.clock === undefined) await pause(ms);
    else subject.clock.advance(ms);
  };
  const { take, enqueue, finish, only, inputs, numbered } = jobStoreHelpers(subject);

  describe('job store (9.5, 14.3.9)', () => {
    jobStoreTenantCases(subject);
    jobStorePendingCases(subject);

    test('a taken job carries its spec, its scope and the attempt the worker holds', async () => {
      const [id] = await enqueue([
        numbered(1, {
          priority: 'high',
          cost: 3,
          apiVersion: '2026-01-01',
          expireInSeconds: 30,
          deadLetter: 'dead-mail',
          retry: { delays: ['1s'], limit: 4 },
        }),
      ]);
      const job = only(await take('w1'));
      expect(job).toMatchObject({
        id,
        attempt: { jobId: id, attempt: 1 },
        queue: 'commands',
        run: { action: 'a', input: 1 },
        scope: tenantA,
        kind: 'action',
        priority: 'high',
        cost: 3,
        apiVersion: '2026-01-01',
        expireInSeconds: 30,
        deadLetter: 'dead-mail',
        retry: { delays: ['1s'], limit: 4 },
        build: { id: 'b1', revision: 1 },
        laneCap: 10,
      });
    });

    test('keys keep, replace and coalesce, and the due jobs are counted', async () => {
      const keyed = (onConflict: 'keep' | 'replace' | 'coalesce', n: number) =>
        numbered(n, { key: { value: `k-${onConflict}`, onConflict } });
      await enqueue([
        keyed('keep', 1),
        keyed('keep', 2),
        keyed('replace', 3),
        keyed('replace', 4),
        keyed('coalesce', 5),
        keyed('coalesce', 6),
      ]);
      const stats = await subject.run(namespaceScope, (unit) => unit.jobs.stats('commands'));
      expect(stats.map((row) => [row.queue, row.due])).toEqual([['commands', 3]]);
      expect([...inputs(await take('w1'))].sort()).toEqual([1, 4, 5]);
    });

    test('promotion moves due scheduled jobs and counts them on their lane', async () => {
      const soon = now().add({ milliseconds: 1500 });
      await enqueue([numbered(1, { runAt: soon }), numbered(2, { runAt: soon }), numbered(3)]);
      expect(inputs(await take('w1'))).toEqual([3]);
      expect(await subject.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10))).toBe(
        0,
      );
      await wait(1600);
      expect(await subject.run(namespaceScope, (unit) => unit.jobs.promote('commands', 1))).toBe(1);
      expect(await subject.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10))).toBe(
        1,
      );
      expect([...inputs(await take('w1'))].sort()).toEqual([1, 2]);
    });

    test('a take serves the priority classes in order', async () => {
      await enqueue([
        numbered(1, { priority: 'low' }),
        numbered(2, { priority: 'normal' }),
        numbered(3, { priority: 'high' }),
      ]);
      expect(inputs(await take('w1'))).toEqual([3, 2, 1]);
    });

    test('a take serves the lane with the least running work first', async () => {
      await enqueue([numbered(1), numbered(2), numbered(3)]);
      await enqueue([numbered(4)], tenantB);
      const first = only(await take('w1', { limit: 1 }));
      const second = only(await take('w2', { limit: 1 }));
      expect(new Set([first.scope, second.scope].map((scope) => JSON.stringify(scope))).size).toBe(
        2,
      );
    });

    test('lanes never run more than their cap', async () => {
      await enqueue([1, 2, 3, 4, 5].map((n) => numbered(n, { laneCap: 2 })));
      const first = await take('w1');
      expect(first).toHaveLength(2);
      expect(await take('w2')).toEqual([]);
      expect(await finish(first[0] as StoredJob, 'w1', succeeded)).toBe(true);
      expect(await take('w2')).toHaveLength(1);
      expect(await take('w2')).toEqual([]);
    });

    test('a take hands out jobs in due order within a lane and respects its batch', async () => {
      const base = now().subtract({ minutes: 10 });
      await enqueue([
        numbered(1, { runAt: base.add({ seconds: 3 }) }),
        numbered(2, { runAt: base.add({ seconds: 1 }) }),
        numbered(3, { runAt: base.add({ seconds: 2 }) }),
      ]);
      expect(inputs(await take('w1', { limit: 2 }))).toEqual([2, 3]);
    });

    test('only jobs of builds up to the worker revision, and lanes of its capability sets, are taken', async () => {
      await enqueue([
        numbered(1, { build: { id: 'b9', revision: 9 } }),
        numbered(2, { capability: ['smtp-out'] }),
      ]);
      expect(await take('w1', { maxRevision: 4 })).toHaveLength(0);
      expect(inputs(await take('w1', { capabilitySets: ['smtp-out'] }))).toEqual([2]);
      expect(inputs(await take('w1', { maxRevision: 9 }))).toEqual([1]);
    });

    test('FIFO per key holds followers back until their predecessor ends', async () => {
      const fifo = (n: number) =>
        numbered(n, { key: { value: 'order', onConflict: 'keep' }, ordering: 'fifo-per-key' });
      await enqueue([fifo(1)]);
      const head = only(await take('w1'));
      await enqueue([fifo(2)]);
      expect(await take('w2')).toEqual([]);
      expect(await finish(head, 'w1', succeeded)).toBe(true);
      const next = only(await take('w2'));
      expect(inputs([next])).toEqual([2]);
      await enqueue([fifo(3)]);
      expect(await take('w3')).toEqual([]);
      expect(await finish(next, 'w2', { kind: 'failed', error: unavailable })).toBe(true);
      expect(inputs(await take('w3'))).toEqual([3]);
    });

    test('append joins the key FIFO as a follower: no job is dropped or replaced, and a dead head releases the next', async () => {
      const appended = (n: number) =>
        numbered(n, { key: { value: 'chain', onConflict: 'append' }, ordering: 'fifo-per-key' });
      await enqueue([appended(1), appended(2), appended(3)]);
      const head = only(await take('w1'));
      expect(inputs([head])).toEqual([1]);
      expect(await take('w2')).toEqual([]);
      expect(await finish(head, 'w1', { kind: 'dead', error: unavailable })).toBe(true);
      const second = only(await take('w2'));
      expect(inputs([second])).toEqual([2]);
      await enqueue([appended(4)]);
      expect(await take('w3')).toEqual([]);
      expect(await finish(second, 'w2', succeeded)).toBe(true);
      const third = only(await take('w3'));
      expect(inputs([third])).toEqual([3]);
      expect(await finish(third, 'w3', succeeded)).toBe(true);
      expect(inputs(await take('w3'))).toEqual([4]);
    });

    test('a group admits as many jobs as its concurrency, and a finished job gives its slot back', async () => {
      const grouped = (n: number) =>
        numbered(n, { group: { id: 'mx:example.com', concurrency: 1 } });
      await enqueue([grouped(1), grouped(2), grouped(3)]);
      const first = only(await take('w1'));
      expect(await take('w2')).toEqual([]);
      expect(await finish(first, 'w1', succeeded)).toBe(true);
      expect(inputs(await take('w2'))).toHaveLength(1);
    });

    test('a group rate admits the tokens it has and holds the rest back', async () => {
      const grouped = (n: number) => numbered(n, { group: { id: 'rate', rate: '2/1h' } });
      await enqueue([grouped(1), grouped(2), grouped(3)]);
      expect(await take('w1')).toHaveLength(2);
      expect(await take('w2')).toEqual([]);
    });

    test('completion and heartbeat are conditional on the worker and the attempt', async () => {
      await enqueue([numbered(1)]);
      const job = only(await take('w1'));
      const stale = { jobId: job.attempt.jobId, attempt: job.attempt.attempt + 1 };
      const heartbeat = (worker: string, attempt = job.attempt) =>
        subject.run(namespaceScope, (unit) => unit.jobs.heartbeat([attempt], worker, 60_000));
      expect(await heartbeat('w2')).toEqual([]);
      expect(await heartbeat('w1', stale)).toEqual([]);
      expect(await heartbeat('w1')).toEqual([job.attempt]);
      expect(
        await subject.run(namespaceScope, (unit) => unit.jobs.complete(stale, 'w1', succeeded)),
      ).toBe(false);
      expect(await finish(job, 'w2', succeeded)).toBe(false);
      expect(await finish(job, 'w1', succeeded)).toBe(true);
      expect(await finish(job, 'w1', succeeded)).toBe(false);
      expect(await heartbeat('w1')).toEqual([]);
    });

    test('a retry schedules the next attempt, which is promoted and taken with the attempt counted', async () => {
      await enqueue([numbered(1)]);
      const job = only(await take('w1'));
      const at = now().add({ milliseconds: 1000 });
      expect(await finish(job, 'w1', { kind: 'retry', at, error: unavailable })).toBe(true);
      expect(await take('w1')).toEqual([]);
      await wait(1100);
      expect(await subject.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10))).toBe(
        1,
      );
      const again = only(await take('w2'));
      expect(again.attempt).toEqual({ jobId: job.id, attempt: 2 });
      expect(await finish(job, 'w1', succeeded)).toBe(false);
      expect(await finish(again, 'w2', succeeded)).toBe(true);
    });

    test('a dead letter and a failure leave the queue; a dead one keeps its row', async () => {
      await enqueue([numbered(1), numbered(2)]);
      const [one, two] = await take('w1');
      expect(await finish(one as StoredJob, 'w1', { kind: 'dead', error: unavailable })).toBe(true);
      expect(await finish(two as StoredJob, 'w1', { kind: 'failed', error: unavailable })).toBe(
        true,
      );
      expect(await take('w1')).toEqual([]);
      const stats = await subject.run(namespaceScope, (unit) => unit.jobs.stats('commands'));
      expect(stats.map((row) => [row.due, row.running])).toEqual([[0, 0]]);
    });

    test('an expired lease is reclaimed by the next take and fenced out; the third loss is a dead letter', async () => {
      await enqueue([numbered(1)]);
      const first = only(await take('w1', { leaseMs: 1 }));
      await wait(25);
      const second = only(await take('w2', { leaseMs: 1 }));
      expect(second.attempt).toEqual({ jobId: first.id, attempt: 2 });
      expect(await finish(first, 'w1', succeeded)).toBe(false);
      await wait(25);
      const third = only(await take('w3', { leaseMs: 1 }));
      expect(third.attempt.attempt).toBe(3);
      await wait(25);
      expect(await take('w4', { leaseMs: 1 })).toEqual([]);
      expect(await finish(third, 'w3', succeeded)).toBe(false);
    });

    test('a heartbeat keeps a lease from being reclaimed', async () => {
      await enqueue([numbered(1)]);
      const job = only(await take('w1', { leaseMs: 800 }));
      await wait(300);
      expect(
        await subject.run(namespaceScope, (unit) =>
          unit.jobs.heartbeat([job.attempt], 'w1', 60_000),
        ),
      ).toEqual([job.attempt]);
      await wait(1000);
      expect(await take('w2')).toEqual([]);
      expect(await finish(job, 'w1', succeeded)).toBe(true);
    });

    test('statistics count due jobs and running attempts per queue and capability set', async () => {
      await enqueue([numbered(1), numbered(2), numbered(3, { capability: ['smtp-out'] })]);
      await take('w1', { limit: 1 });
      const stats = await subject.run(namespaceScope, (unit) => unit.jobs.stats());
      expect(
        stats.map((row) => [row.queue, row.capabilities.join(), row.due + row.running]),
      ).toEqual([
        ['commands', '', 2],
        ['commands', 'smtp-out', 1],
      ]);
      const [plain] = stats;
      expect(plain?.running).toBe(1);
      expect(plain?.sloSeconds).toBe(0);
      expect(await subject.run(namespaceScope, (unit) => unit.jobs.stats('timers'))).toEqual([]);
    });
  });
}
