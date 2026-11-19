import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendPurgeKept } from './append-purge-kept.ts';
import { appendPurgeReceipt } from './append-purge-receipt.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { purgeReceiptType } from './purge-receipt-type.ts';
import { purgeRecord } from './purge-record.ts';
import { purgeTransientKit } from './purge-transient-kit.ts';

const { tenantA, tenantB } = conformanceScopes;

/**
 * What `EventStore.purgeTransient` does with the records of a receipt whose row is gone, and
 * which lists it takes (15.1.11, 14.7.1), against every adapter: a receipt stream serves no one
 * once its receipt is purged, so its newest record goes too; only the stream type of receipt
 * change records may be named.
 */
export function purgeTransientReceiptCases(
  subject: Pick<ConformanceSubject, 'run' | 'read'>,
): void {
  const { purgeBatch, versions, receipts, dropReceipt } = purgeTransientKit(subject);

  describe('purge transient of receipt streams (15.1.11)', () => {
    test('takes the newest record of a receipt stream too once the receipt row is gone, and the stream starts again at version 1', async () => {
      await receipts([1, 2]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [purgeRecord(1, 1), purgeRecord(2, 2)]),
          appendPurgeReceipt(2, [purgeRecord(11, 1), purgeRecord(12, 2)]),
        ]),
      );
      await dropReceipt(1);
      // Stream 1 has no receipt: both records are candidates. Stream 2 keeps its newest.
      expect(await purgeBatch(100, 10)).toEqual({ removed: 3, more: false });
      expect(await versions(1)).toEqual([]);
      expect(await versions(2)).toEqual([2]);
      expect(await purgeBatch(100, 10)).toEqual({ removed: 0, more: false });
      // A command id that returns after its receipt was purged is a new stream.
      const appended = await subject.run(tenantA, (unit) =>
        unit.events.append([appendPurgeReceipt(1, [purgeRecord(21, 3)])]),
      );
      expect(appended.map((entry) => entry.version)).toEqual([1]);
    });

    test('a stream whose receipt is gone is a candidate in the question whether any is left', async () => {
      await receipts([1]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([appendPurgeReceipt(1, [purgeRecord(1, 1)])]),
      );
      expect(await purgeBatch(100, 10)).toEqual({ removed: 0, more: false });
      await dropReceipt(1);
      expect(await purgeBatch(100, 1)).toEqual({ removed: 1, more: false });
    });

    test('never takes a chained event, a receipt or none', async () => {
      await receipts([1]);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [
            purgeRecord(1, 1),
            { ...purgeRecord(2, 2), hash: 'cd'.repeat(32) },
          ]),
        ]),
      );
      await dropReceipt(1);
      expect(await purgeBatch(100, 10)).toEqual({ removed: 1, more: false });
      expect(await versions()).toEqual([2]);
    });

    test("another scope's receipt keeps nothing here, and its records stay whatever this scope lacks", async () => {
      await receipts([1], tenantB);
      await subject.run(tenantB, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [purgeRecord(1, 1), purgeRecord(2, 2)], 0, tenantB),
        ]),
      );
      await subject.run(tenantA, (unit) =>
        unit.events.append([appendPurgeReceipt(1, [purgeRecord(3, 1), purgeRecord(4, 2)])]),
      );
      // Tenant A has no receipt of its own: its stream goes. Tenant B's receipt lives: it keeps its
      // newest.
      expect(await purgeBatch(100, 10, tenantA)).toEqual({ removed: 2, more: false });
      expect(await versions(1, tenantB)).toEqual([1, 2]);
      expect(await purgeBatch(100, 10, tenantB)).toEqual({ removed: 1, more: false });
      expect(await versions(1, tenantB)).toEqual([2]);
    });

    test('refuses a list that names a type retention may not purge, and removes nothing', async () => {
      await receipts([1]);
      await dropReceipt(1);
      await subject.run(tenantA, (unit) =>
        unit.events.append([
          appendPurgeReceipt(1, [purgeRecord(1, 1), purgeRecord(2, 2)]),
          appendPurgeKept(2, [purgeRecord(11, 1), purgeRecord(12, 2)]),
        ]),
      );
      for (const types of [['conf.kept'], [purgeReceiptType, 'conf.kept']]) {
        expect(await failureOf(purgeBatch(100, 10, tenantA, types))).toEqual({
          kind: 'validation',
          code: 'core.malformed_request',
        });
      }
      expect(await versions()).toEqual([1, 2]);
    });
  });
}
