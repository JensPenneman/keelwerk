import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendPurgeKept } from './append-purge-kept.ts';
import { appendPurgeReceipt } from './append-purge-receipt.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { newEvent } from './new-event.ts';
import { purgeReceiptStream } from './purge-receipt-stream.ts';
import { purgeReceiptType } from './purge-receipt-type.ts';
import { purgeRecord } from './purge-record.ts';
import { purgeTransientKit } from './purge-transient-kit.ts';
import { stamp } from './stamp.ts';

const { tenantA, tenantB } = conformanceScopes;

/**
 * `EventStore.purgeTransient` (15.1.11, 14.7.1), against every adapter: the committed transient
 * records of the unit's scope before an instant, of the one purgeable stream type (the change
 * records of receipts), go oldest first up to the limit, a stream's newest record never while its
 * receipt lives, a record with a hash or a previous hash never, and nothing of another scope.
 */
export function purgeTransientCases(subject: Pick<ConformanceSubject, 'run' | 'read'>): void {
  const { purgeBatch, purge, versions, receipts } = purgeTransientKit(subject);

  describe('purge transient (15.1.11)', () => {
    test('removes transient records older than before, oldest first, up to the limit', async () => {
      await receipts([1]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(
            1,
            [1, 2, 3, 4, 5].map((n) => purgeRecord(n, 2 * n)),
          ),
        ]),
      );
      expect(await purge(0, 10)).toBe(0);
      // Records 1 to 3 (hours 2, 4 and 6) are older than 7 hours; the limit takes the oldest two.
      expect(await purge(7, 2)).toBe(2);
      expect(await versions()).toEqual([3, 4, 5]);
      expect(await purge(7, 10)).toBe(1);
      expect(await versions()).toEqual([4, 5]);
      expect(await purge(100, 10)).toBe(1);
      expect(await versions()).toEqual([5]);
      expect(await purge(100, 10)).toBe(0);
    });

    test('says whether a candidate is left, from what is stored and not from the batch size', async () => {
      await receipts([1, 2]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(
            1,
            [1, 2, 3, 4, 5].map((n) => purgeRecord(n, 2 * n)),
          ),
        ]),
      );
      // Four candidates (the newest record stays): a full batch with some left, then one that
      // takes the rest exactly, which is not short and still says nothing is left.
      expect(await purgeBatch(100, 3)).toEqual({ removed: 3, more: true });
      expect(await purgeBatch(100, 1)).toEqual({ removed: 1, more: false });
      expect(await purgeBatch(100, 10)).toEqual({ removed: 0, more: false });
      // A candidate that is not due yet is not a candidate.
      await subject.run(tenantA, (unit) =>
        unit.events.append([appendPurgeReceipt(2, [purgeRecord(11, 500), purgeRecord(12, 501)])]),
      );
      expect(await purgeBatch(100, 10)).toEqual({ removed: 0, more: false });
      expect(await purgeBatch(600, 10)).toEqual({ removed: 1, more: false });
    });

    test('keeps the newest record of each stream of a live receipt, so the next append continues its version', async () => {
      await receipts([1, 2]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [purgeRecord(1, 1), purgeRecord(2, 2)]),
          appendPurgeReceipt(2, [purgeRecord(11, 1)]),
        ]),
      );
      expect(await purge(100, 10)).toBe(1);
      expect(await versions()).toEqual([2]);
      expect(await versions(2)).toEqual([1]);
      const appended = await subject.run(tenantA, (unit) =>
        unit.events.append([appendPurgeReceipt(1, [purgeRecord(3, 3)], 2)]),
      );
      expect(appended.map((entry) => entry.version)).toEqual([3]);
      expect(await versions()).toEqual([2, 3]);
    });

    test('never removes a chained event', async () => {
      await receipts([1]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [
            newEvent(1, { recordedAt: stamp.add({ hours: 1 }), hash: 'cd'.repeat(32) }),
            purgeRecord(2, 2),
            newEvent(3, { recordedAt: stamp.add({ hours: 3 }), hash: 'ef'.repeat(32) }),
            purgeRecord(4, 4),
          ]),
        ]),
      );
      expect(await purge(100, 10)).toBe(1);
      expect(await versions()).toEqual([1, 3, 4]);
    });

    test('keeps a transient record that carries a hash or a previous hash', async () => {
      await receipts([1]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [
            newEvent(1, {
              transient: true,
              recordedAt: stamp.add({ hours: 1 }),
              hash: 'cd'.repeat(32),
            }),
            newEvent(2, {
              transient: true,
              recordedAt: stamp.add({ hours: 2 }),
              prevHash: 'cd'.repeat(32),
            }),
            purgeRecord(3, 3),
            purgeRecord(4, 4),
          ]),
        ]),
      );
      expect(await purge(100, 10)).toBe(1);
      expect(await versions()).toEqual([1, 2, 4]);
    });

    test('keeps head(selector) where it was while the receipts live', async () => {
      await receipts([1, 2]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(
            1,
            [1, 2, 3].map((n) => purgeRecord(n, n)),
          ),
          appendPurgeReceipt(2, [purgeRecord(11, 1), purgeRecord(12, 2)]),
        ]),
      );
      const heads = () =>
        subject.read(tenantA, async (unit) => [
          await unit.events.head(),
          await unit.events.head({ names: ['changed'] }),
          await unit.events.head({ streams: [purgeReceiptStream(1)] }),
        ]);
      const before = await heads();
      expect(await purge(100, 10)).toBe(3);
      expect(await heads()).toEqual(before);
    });

    test("leaves another scope's records", async () => {
      await receipts([1]);
      await receipts([1], tenantB);
      await subject.run(tenantA, (unit) =>
        unit.events.append([appendPurgeReceipt(1, [purgeRecord(1, 1), purgeRecord(2, 2)])]),
      );
      await subject.run(tenantB, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [purgeRecord(3, 1), purgeRecord(4, 2)], 0, tenantB),
        ]),
      );
      expect(await purge(100, 10, tenantB)).toBe(1);
      expect(await versions(1, tenantA)).toEqual([1, 2]);
      expect(await versions(1, tenantB)).toEqual([2]);
    });

    test('keeps the record of a stream type that is not listed, whatever its age', async () => {
      await receipts([1]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [purgeRecord(1, 1), purgeRecord(2, 2)]),
          appendPurgeKept(2, [purgeRecord(11, 1), purgeRecord(12, 2)]),
        ]),
      );
      expect(await purgeBatch(100, 10)).toEqual({ removed: 1, more: false });
      expect(await versions()).toEqual([2]);
      const kept = await subject.read(tenantA, (unit) =>
        unit.events.readStream({ type: 'conf.kept', id: conformanceId(2) }, { limit: 100 }),
      );
      expect(kept.map((event) => event.version)).toEqual([1, 2]);
    });

    test('removes nothing for an empty list and answers no candidate', async () => {
      await receipts([1]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [purgeRecord(1, 1), purgeRecord(2, 2), purgeRecord(3, 3)]),
        ]),
      );
      expect(await purgeBatch(100, 10, tenantA, [])).toEqual({ removed: 0, more: false });
      expect(await versions()).toEqual([1, 2, 3]);
    });

    test('asks about candidates of the listed type only', async () => {
      await receipts([1]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [purgeRecord(1, 1), purgeRecord(2, 2)]),
          appendPurgeKept(2, [purgeRecord(11, 1), purgeRecord(12, 2), purgeRecord(13, 3)]),
        ]),
      );
      // One listed candidate and two older-or-equal unlisted ones: a batch of one drains it.
      expect(await purgeBatch(100, 1)).toEqual({ removed: 1, more: false });
      expect(await purgeBatch(100, 1)).toEqual({ removed: 0, more: false });
    });

    test('refuses a read-only unit', async () => {
      expect(
        await failureOf(
          subject.read(tenantA, (unit) =>
            unit.events.purgeTransient(stamp.add({ hours: 1 }), 10, [purgeReceiptType]),
          ),
        ),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
    });

    test('refuses a limit outside 1 to 100000', async () => {
      for (const limit of [0, -1, 100_001, 1.5]) {
        expect(await failureOf(purge(1, limit))).toEqual({
          kind: 'validation',
          code: 'core.malformed_request',
        });
      }
    });

    test('is refused in a namespace-scope unit, which has no event log', async () => {
      const refusal = await failureOf(
        subject.run({ level: 'namespace', reason: 'conformance' }, (unit) =>
          unit.events.purgeTransient(stamp.add({ hours: 1 }), 10, [purgeReceiptType]),
        ),
      );
      expect(refusal).toEqual({ kind: 'internal', code: 'core.internal' });
    });
  });
}
