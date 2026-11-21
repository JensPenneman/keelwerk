import type { Unit } from '@keelwerk/core';
import { conformanceEntities, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';
import { quotaRejection } from './quota-rejection.ts';
import { rowAt } from './row-at.ts';
import { usageChargeOf } from './usage-charge-of.ts';
import { usageOf } from './usage-of.ts';

const { owner } = conformanceEntities;
const { tenantA, tenantB } = conformanceScopes;
const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;

/**
 * The commit tail's storage charges and queued cap (12.2, 9.5.5, 15.1.4): what a unit's charges do
 * to the counters of `kw_usage`, when the unit is refused and rolls back, and how the queued cap of
 * an enqueue reads the available jobs of the queue, against every adapter.
 */
export function commitTailQuotaCases(
  subject: Pick<ConformanceSubject, 'run' | 'read' | 'clock'>,
): void {
  const { enqueue, take, numbered } = jobStoreHelpers(subject);
  const usage = usageOf(subject);

  describe('usage charges', () => {
    test('a charge adds to the counter at the commit tail', async () => {
      await subject.run(tenantA, async (unit) => unit.usage.charge([usageChargeOf(3n, null)]));
      await subject.run(tenantA, async (unit) => unit.usage.charge([usageChargeOf(2n, 10n)]));
      expect(await usage()).toBe(5n);
      expect(await usage('core.rows', tenantB)).toBe(0n);
    });

    test('a unit over a limit rolls back its rows, events and counter', async () => {
      const refused = await quotaRejection(
        subject.run(tenantA, async (unit) => {
          await unit.rows.insert(owner, [rowAt(1, { name: 'a' })]);
          await unit.events.append([appendOf(1, [1])]);
          unit.usage.charge([usageChargeOf(5n, 4n)]);
        }),
      );
      expect(refused.kind).toBe('rate_limited');
      expect(refused.code).toBe('core.quota_exceeded');
      expect(refused.retryable).toBe(false);
      expect(refused.details).toEqual({ dimension: 'core.rows', limit: 4, value: 5 });
      expect(await subject.read(tenantA, (unit) => unit.rows.count(owner))).toBe(0);
      expect(
        (await subject.read(tenantA, (unit) => unit.events.readAll(null, { limit: 10 }))).events,
      ).toHaveLength(0);
      expect(await usage()).toBe(0n);
    });

    test('the limit applies to the counter after earlier units, and a value at the limit is admitted', async () => {
      await subject.run(tenantA, async (unit) => unit.usage.charge([usageChargeOf(3n, 5n)]));
      await subject.run(tenantA, async (unit) => unit.usage.charge([usageChargeOf(2n, 5n)]));
      const refused = await quotaRejection(
        subject.run(tenantA, async (unit) => unit.usage.charge([usageChargeOf(1n, 5n)])),
      );
      expect(refused.details).toEqual({ dimension: 'core.rows', limit: 5, value: 6 });
      expect(await usage()).toBe(5n);
    });

    test('a give-back lowers the counter and is never refused, also above a limit', async () => {
      const own = 'conformance.count';
      await subject.run(tenantA, async (unit) => unit.usage.charge([usageChargeOf(5n, null, own)]));
      await subject.run(tenantA, async (unit) => {
        unit.usage.giveBack(own, 2n);
        unit.usage.charge([usageChargeOf(0n, 1n, own)]);
      });
      expect(await usage(own)).toBe(3n);
    });

    test('a give-back of a counter of the framework is internal and lowers nothing', async () => {
      await subject.run(tenantA, async (unit) =>
        unit.usage.charge([usageChargeOf(5n, null), usageChargeOf(7n, null, 'core.eventBytes')]),
      );
      for (const dimension of ['core.rows', 'core.eventBytes']) {
        expect(
          await failureOf(subject.run(tenantA, async (unit) => unit.usage.giveBack(dimension, 1n))),
        ).toEqual({ kind: 'internal', code: 'core.internal' });
      }
      expect(await usage()).toBe(5n);
      expect(await usage('core.eventBytes')).toBe(7n);
    });

    test('a charge below 0, a give-back below 0 and a give-back in a namespace unit are internal', async () => {
      const internal = { kind: 'internal', code: 'core.internal' };
      expect(
        await failureOf(
          subject.run(tenantA, async (unit) => unit.usage.charge([usageChargeOf(-1n, null)])),
        ),
      ).toEqual(internal);
      expect(
        await failureOf(
          subject.run(tenantA, async (unit) => unit.usage.giveBack('conformance.count', -1n)),
        ),
      ).toEqual(internal);
      expect(
        await failureOf(
          subject.run(namespaceScope, async (unit) => unit.usage.giveBack('conformance.count', 1n)),
        ),
      ).toEqual(internal);
      expect(await usage()).toBe(0n);
    });

    test('a savepoint that fails takes its charges back', async () => {
      await subject.run(tenantA, async (unit) => {
        unit.usage.charge([usageChargeOf(1n, 1n)]);
        const failed = await unit
          .nested(async (inner) => {
            inner.usage.charge([usageChargeOf(7n, 1n)]);
            throw new Error('inner');
          })
          .catch((error: unknown) => error);
        expect(failed).toBeInstanceOf(Error);
      });
      expect(await usage()).toBe(1n);
    });

    test('a unit that only charges still runs the tail', async () => {
      const refused = await failureOf(
        subject.run(tenantA, async (unit) => unit.usage.charge([usageChargeOf(2n, 1n)])),
      );
      expect(refused).toEqual({ kind: 'rate_limited', code: 'core.quota_exceeded' });
      expect(await usage()).toBe(0n);
    });

    test('charges of one dimension are summed and the smallest limit applies', async () => {
      const refused = await quotaRejection(
        subject.run(tenantA, async (unit) =>
          unit.usage.charge([
            usageChargeOf(3n, 10n),
            usageChargeOf(4n, 5n),
            usageChargeOf(1n, null),
          ]),
        ),
      );
      expect(refused.details).toEqual({ dimension: 'core.rows', limit: 5, value: 8 });
      await subject.run(tenantA, async (unit) => {
        unit.usage.charge([
          usageChargeOf(6n, 10n, 'conformance.rows'),
          usageChargeOf(2n, null, 'conformance.bytes'),
          usageChargeOf(1n, null, 'conformance.bytes'),
        ]);
        unit.usage.giveBack('conformance.rows', 2n);
        unit.usage.giveBack('conformance.bytes', 3n);
      });
      expect(await usage('conformance.rows')).toBe(4n);
      expect(await usage('conformance.bytes')).toBe(0n);
    });

    test('a charge in a namespace unit is refused as internal', async () => {
      expect(
        await failureOf(
          subject.run(namespaceScope, async (unit) => unit.usage.charge([usageChargeOf(1n, null)])),
        ),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
    });

    test('two units at the limit at once: one commits, the other is refused', async () => {
      const results = await Promise.allSettled(
        [1, 2].map((n) =>
          subject.run(tenantA, async (unit) => {
            await unit.rows.insert(owner, [rowAt(n, { name: `unit ${n}` })]);
            unit.usage.charge([usageChargeOf(1n, 1n)]);
          }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failed = results.filter((result) => result.status === 'rejected');
      expect(failed).toHaveLength(1);
      expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'core.quota_exceeded',
      });
      expect(await usage()).toBe(1n);
      expect(await subject.read(tenantA, (unit) => unit.rows.count(owner))).toBe(1);
    });
  });

  describe('the queued cap', () => {
    const capped = (n: number, cap: number, over = {}) => numbered(n, { queuedCap: cap, ...over });
    const available = (scope: typeof tenantA): Promise<number> =>
      subject.run(scope, (unit: Unit) => unit.jobs.queued('commands', 100));

    test('the next enqueue over the queued cap is core.queue_full with retryAfter 1 and rolls back, and another tenant enqueues', async () => {
      await enqueue([capped(1, 2), capped(2, 2)]);
      const refused = await quotaRejection(enqueue([capped(3, 2)]));
      expect(refused.kind).toBe('rate_limited');
      expect(refused.code).toBe('core.queue_full');
      expect(refused.retryable).toBe(true);
      expect(refused.retryAfter).toBe(1);
      expect(refused.details).toEqual({ queue: 'commands', limit: 2, value: 3 });
      expect(await available(tenantA)).toBe(2);
      await enqueue([capped(4, 2)], tenantB);
      expect(await available(tenantB)).toBe(1);
    });

    test('the cap counts available jobs of every lane of the queue, not scheduled or taken ones', async () => {
      await enqueue([
        capped(1, 2, { priority: 'high' }),
        capped(2, 2, { priority: 'low' }),
        capped(3, 2, { runAt: (subject.clock?.now() ?? Temporal.Now.instant()).add({ hours: 1 }) }),
      ]);
      await take('w1', { limit: 1 });
      await enqueue([capped(4, 2)]);
      expect((await quotaRejection(enqueue([capped(5, 2)]))).code).toBe('core.queue_full');
    });

    test('a job spec without queuedCap is never refused and a taken job has no queuedCap', async () => {
      await enqueue([capped(1, 1)]);
      await enqueue([numbered(2), numbered(3), numbered(4)]);
      const taken = await take('w1', { limit: 10 });
      expect(taken).toHaveLength(4);
      for (const job of taken) expect('queuedCap' in job).toBe(false);
    });
  });
}
