import type { JobOutcome, Unit, WireError } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';
import { quotaRejection } from './quota-rejection.ts';

const { tenantA, tenantB } = conformanceScopes;
const unavailable: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'down',
  retryable: true,
  requestId: 'r',
};
const dead: JobOutcome = { kind: 'dead', error: unavailable };

/**
 * What the queued cap counts (9.5.5): the jobs of the queue in the scope that wait to run, which
 * are the jobs the statistics and `JobStore.queued` count, as the unit leaves them (its cancels and
 * replaces included); a refusal says limit + 1. The cases read the count
 * through the ways it can be read and ask the cap about states and moves of a job, against
 * every adapter.
 */
export function queuedCapCountCases(subject: Pick<ConformanceSubject, 'run' | 'clock'>): void {
  const { enqueue, take, finish, only, inputs, numbered } = jobStoreHelpers(subject);
  const later = (): Temporal.Instant =>
    (subject.clock?.now() ?? Temporal.Now.instant()).add({ hours: 1 });
  const capped = (n: number, cap: number, over = {}) => numbered(n, { queuedCap: cap, ...over });
  const keyed = (value: string, onConflict: 'keep' | 'replace' | 'coalesce' | 'append') => ({
    key: { value, onConflict },
  });
  /** A job that waits behind the first one of its key and becomes available when that one ends. */
  const chained = (n: number, cap: number) =>
    capped(n, cap, { ...keyed('chain', 'append'), ordering: 'fifo-per-key' });
  const queued = (scope: typeof tenantA = tenantA): Promise<number> =>
    subject.run(scope, (unit: Unit) => unit.jobs.queued('commands', 100));
  const statistics = (): Promise<number> =>
    subject.run(tenantA, async (unit: Unit) =>
      (await unit.jobs.stats('commands')).reduce((sum, row) => sum + row.queued, 0),
    );
  /** What the cap refuses the enqueue of one more capped job with. */
  const refusal = async (cap: number, over = {}): Promise<unknown> => {
    const error = await quotaRejection(enqueue([capped(99, cap, over)]));
    expect(error.code).toBe('core.queue_full');
    return error.details;
  };

  describe('the queued cap counts the jobs that wait to run', () => {
    test('the cap, the statistics and JobStore.queued read one number', async () => {
      // One running and one dead job, which no count includes.
      await enqueue([numbered(1, { priority: 'low' })]);
      only(await take('w0', { limit: 1 }));
      await enqueue([numbered(2, { priority: 'low' })]);
      const dying = only(await take('w1', { limit: 1 }));
      expect(await finish(dying, 'w1', dead)).toBe(true);
      // Four that wait: scheduled, available in two lanes, waiting behind a key head.
      await enqueue([
        numbered(3, { runAt: later() }),
        numbered(4, { priority: 'high' }),
        numbered(5, { ...keyed('chain', 'append'), ordering: 'fifo-per-key' }),
        numbered(6, { ...keyed('chain', 'append'), ordering: 'fifo-per-key' }),
      ]);
      // Another queue and another tenant, which no count of this queue includes.
      await enqueue([numbered(7, { queue: 'timers' })]);
      await enqueue([numbered(8)], tenantB);
      expect(await statistics()).toBe(4);
      expect(await queued()).toBe(4);
      expect(await refusal(4)).toEqual({ queue: 'commands', limit: 4, value: 5 });
      expect(await queued()).toBe(4);
      await enqueue([capped(98, 5)]);
      expect(await statistics()).toBe(5);
      expect(await queued()).toBe(5);
    });

    test('a scheduled job and a key head count, and a new job of any state is refused at the cap', async () => {
      await enqueue([capped(1, 2, { runAt: later() }), chained(2, 2)]);
      expect(await queued()).toBe(2);
      const states = [
        ['scheduled', { runAt: later() }],
        ['available', {}],
        ['waiting', { ...keyed('chain', 'append'), ordering: 'fifo-per-key' }],
      ] as const;
      for (const [state, over] of states) {
        expect(await refusal(2, over), state).toEqual({ queue: 'commands', limit: 2, value: 3 });
        expect(await queued(), state).toBe(2);
      }
    });

    test('a replace or a cancel with an enqueue at the cap is decided by the count after the unit', async () => {
      await enqueue([capped(1, 2, keyed('k', 'replace')), numbered(2)]);
      await enqueue([capped(3, 2, keyed('k', 'replace'))]);
      expect(await queued()).toBe(2);
      await subject.run(tenantA, async (unit: Unit) => {
        expect(await unit.jobs.cancel('commands', 'k')).toBe(1);
        await unit.jobs.enqueue({ ...capped(4, 2, keyed('k', 'append')), scope: tenantA });
      });
      expect(await queued()).toBe(2);
      expect([...inputs(await take('w1', { limit: 10 }))].sort()).toEqual([2, 4]);
    });

    test('above the cap a replace is refused, a cancel is not, and the count falls with it', async () => {
      await enqueue([capped(1, 1, keyed('k', 'replace'))]);
      await enqueue([numbered(2)]);
      expect(await queued()).toBe(2);
      const refused = await quotaRejection(enqueue([capped(3, 1, keyed('k', 'replace'))]));
      expect(refused.details).toEqual({ queue: 'commands', limit: 1, value: 2 });
      expect(await queued()).toBe(2);
      expect(await subject.run(tenantA, (unit: Unit) => unit.jobs.cancel('commands', 'k'))).toBe(1);
      expect(await queued()).toBe(1);
      await enqueue([capped(4, 2)]);
      expect(await queued()).toBe(2);
    });

    test('above the cap a keep and a coalesce insert nothing and are admitted, a plain enqueue is refused', async () => {
      const [kept] = await enqueue([capped(1, 1, keyed('keep', 'keep'))]);
      const [soon] = await enqueue([numbered(2, { ...keyed('soon', 'coalesce'), runAt: later() })]);
      await enqueue([numbered(3)]);
      expect(await queued()).toBe(3);
      // A keep that finds its job and a coalesce that makes a job due add nothing: the count stays.
      const [again] = await enqueue([capped(4, 1, keyed('keep', 'keep'))]);
      expect(again).toBe(kept);
      const [due] = await enqueue([capped(5, 1, keyed('soon', 'coalesce'))]);
      expect(due).toBe(soon);
      expect(await queued()).toBe(3);
      // A plain capped enqueue is judged by the true count, whether it comes alone or in a unit
      // beside a keep and a coalesce, which a refusal rolls back with it.
      expect(await refusal(1)).toEqual({ queue: 'commands', limit: 1, value: 2 });
      expect(await refusal(3)).toEqual({ queue: 'commands', limit: 3, value: 4 });
      const beside = await quotaRejection(
        enqueue([
          capped(6, 3, keyed('keep', 'keep')),
          capped(7, 3, keyed('soon', 'coalesce')),
          capped(8, 3),
        ]),
      );
      expect(beside.details).toEqual({ queue: 'commands', limit: 3, value: 4 });
      expect(await queued()).toBe(3);
      await enqueue([capped(9, 4)]);
      expect(await queued()).toBe(4);
    });

    test('a cancel by key takes every job that waits to run: available, waiting and scheduled', async () => {
      const follower = (n: number) =>
        numbered(n, { ...keyed('chain', 'append'), ordering: 'fifo-per-key' });
      await enqueue([follower(1), follower(2), follower(3)]);
      await enqueue([numbered(4, { ...keyed('later', 'append'), runAt: later() })]);
      expect(await queued()).toBe(4);
      const cancel = (key: string) =>
        subject.run(tenantA, (unit: Unit) => unit.jobs.cancel('commands', key));
      expect(await cancel('chain')).toBe(3);
      expect(await cancel('later')).toBe(1);
      expect(await queued()).toBe(0);
    });

    test('the smallest cap of the capped jobs a unit inserts into a queue applies', async () => {
      const refused = await quotaRejection(enqueue([capped(1, 5), capped(2, 1)]));
      expect(refused.details).toEqual({ queue: 'commands', limit: 1, value: 2 });
      expect(await queued()).toBe(0);
      await enqueue([capped(3, 5), capped(4, 5)]);
      expect(await queued()).toBe(2);
    });

    test('a nested unit that fails takes its capped job and its cap back', async () => {
      await enqueue([numbered(1), numbered(2)]);
      await subject.run(tenantA, async (unit: Unit) => {
        const failed = await unit
          .nested(async (inner) => {
            await inner.jobs.enqueue({ ...capped(3, 1), scope: tenantA });
            throw new Error('inner');
          })
          .catch((error: unknown) => error);
        expect(failed).toBeInstanceOf(Error);
        await unit.jobs.enqueue({ ...numbered(4), scope: tenantA });
      });
      expect(await queued()).toBe(3);
    });

    test.each([
      ['below 0', -1],
      ['fractional', 1.5],
      ['not a number', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
      ['past the greatest safe integer', 2 ** 53],
    ])(
      'a queued cap that is %s is refused as malformed and nothing is written',
      async (_name, cap) => {
        const refused = await quotaRejection(enqueue([capped(1, cap)]));
        expect(refused.kind).toBe('validation');
        expect(refused.code).toBe('core.malformed_request');
        expect(await queued()).toBe(0);
      },
    );

    test('a queued cap of 0 refuses every capped enqueue and no uncapped one', async () => {
      expect(await refusal(0)).toEqual({ queue: 'commands', limit: 0, value: 1 });
      expect(await queued()).toBe(0);
      await enqueue([numbered(1)]);
      expect(await queued()).toBe(1);
    });
  });
}
