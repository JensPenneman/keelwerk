import type { Unit, WireError } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { conformanceWait } from './conformance-wait.ts';
import { flushJobWakes } from './flush-job-wakes.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';
import { tapJobWakes } from './job-wake-tap.ts';
import { quotaRejection } from './quota-rejection.ts';

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
 * The queued cap is a rule of admission (9.5.5): only the enqueue of a new capped job at a commit
 * tail is refused by it. A move the framework makes with work already admitted (a key's next job,
 * a release, a retry, a reclaimed lease) is never refused and keeps the count of the jobs that wait
 * to run true, so it can stand above the cap; a refused enqueue changes nothing and wakes nothing.
 */
export function queuedCapAdmissionCases(
  subject: Pick<ConformanceSubject, 'run' | 'clock' | 'adapter' | 'namespace'>,
): void {
  const { enqueue, take, finish, only, numbered } = jobStoreHelpers(subject);
  describe('the queued cap is a rule of admission', () => {
    const capped = (n: number, cap: number, over = {}) => numbered(n, { queuedCap: cap, ...over });
    const queued = (scope: typeof tenantA): Promise<number> =>
      subject.run(scope, (unit: Unit) => unit.jobs.queued('commands', 100));
    /** A job that waits behind the first one of its key and becomes available when that one ends. */
    const chained = (n: number, cap: number) =>
      capped(n, cap, { key: { value: 'chain', onConflict: 'append' }, ordering: 'fifo-per-key' });
    /** What the cap refuses an enqueue with: the count is read up to the cap plus one, so `value` is `limit + 1`. */
    const refusedAt = async (cap: number): Promise<unknown> =>
      (await quotaRejection(enqueue([capped(99, cap)]))).details;

    test('a key becoming available is never refused: the count stays true, and the next enqueue waits', async () => {
      await enqueue([chained(1, 2), chained(2, 2)]);
      const first = only(await take('w1', { limit: 1 }));
      // The follower waits behind the running head, and it counts: a cap of 1 is at its count.
      expect(await queued(tenantA)).toBe(1);
      expect(await refusedAt(1)).toEqual({ queue: 'commands', limit: 1, value: 2 });
      await enqueue([capped(3, 2)]);
      expect(await finish(first, 'w1', { kind: 'succeeded' })).toBe(true);
      expect(await queued(tenantA)).toBe(2);
      expect(await refusedAt(2)).toEqual({ queue: 'commands', limit: 2, value: 3 });
      expect(await queued(tenantA)).toBe(2);
      await take('w2', { limit: 10 });
      await enqueue([capped(4, 2)]);
      expect(await queued(tenantA)).toBe(1);
    });

    test('a release at a drain is never refused: the count stands above the cap', async () => {
      await enqueue([capped(1, 1)]);
      const running = only(await take('w1', { limit: 1 }));
      await enqueue([capped(2, 1)]);
      const released = await subject.run(namespaceScope, (unit) =>
        unit.jobs.release([running.attempt], 'w1'),
      );
      expect(released).toEqual([running.attempt]);
      expect(await queued(tenantA)).toBe(2);
      expect(await refusedAt(1)).toEqual({ queue: 'commands', limit: 1, value: 2 });
    });

    test('a retry is never refused: it counts as scheduled after its settle and is counted once at its promotion', async () => {
      await enqueue([capped(1, 1)]);
      const running = only(await take('w1', { limit: 1 }));
      expect(await queued(tenantA)).toBe(0);
      const at = (subject.clock?.now() ?? Temporal.Now.instant()).subtract({ seconds: 1 });
      expect(await finish(running, 'w1', { kind: 'retry', at, error: unavailable })).toBe(true);
      // The retry waits as scheduled, which counts, until the promotion makes it available.
      expect(await queued(tenantA)).toBe(1);
      expect(await refusedAt(1)).toEqual({ queue: 'commands', limit: 1, value: 2 });
      expect(await subject.run(namespaceScope, (unit) => unit.jobs.promote('commands', 10))).toBe(
        1,
      );
      expect(await queued(tenantA)).toBe(1);
      expect(await refusedAt(1)).toEqual({ queue: 'commands', limit: 1, value: 2 });
    });

    test('a reclaim after a lost lease is never refused: the count stays true', async () => {
      await enqueue([capped(1, 1)]);
      only(await take('w1', { limit: 1, leaseMs: 1 }));
      await enqueue([capped(2, 1)]);
      const wait = conformanceWait(subject);
      await wait(25);
      const reclaimed = only(await take('w2', { limit: 1, leaseMs: 60_000 }));
      expect(reclaimed.attempt.attempt).toBe(2);
      expect(await queued(tenantA)).toBe(1);
      expect(await refusedAt(1)).toEqual({ queue: 'commands', limit: 1, value: 2 });
    });

    test('a refused enqueue changes nothing and wakes nothing', async () => {
      await enqueue([capped(1, 1)]);
      const tap = tapJobWakes(subject.adapter().feed);
      const stop = new AbortController();
      const reading = (async () => {
        for await (const _ of tap.jobs([subject.namespace()], stop.signal)) {
          // The test reads what the tap received.
        }
      })();
      try {
        const polling = subject.adapter().feed.level === 'poll';
        if (!polling) {
          await tap.next();
          await flushJobWakes(tap, async (queue) => {
            await enqueue([numbered(1, { queue })]);
          });
        }
        let refused: Unit | undefined;
        const error = await quotaRejection(
          subject.run(tenantA, async (unit) => {
            refused = unit;
            await unit.jobs.enqueue({ ...capped(2, 1), scope: tenantA });
          }),
        );
        expect(error.code).toBe('core.queue_full');
        expect(refused?.jobs.readied()).toEqual([]);
        expect(await queued(tenantA)).toBe(1);
        if (!polling) {
          await enqueue([numbered(3, { queue: 'marker' })]);
          expect(await tap.next()).toEqual({
            namespace: subject.namespace().id,
            queues: ['marker'],
          });
        }
      } finally {
        stop.abort();
        await reading;
      }
    });
  });
}
