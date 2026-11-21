import type { NewEvent, StreamAppend } from '@keelwerk/core';
import { storedEventBytes, storedStreamRecordBytes } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
import { appendPurgeReceipt } from './append-purge-receipt.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { purgeReceiptType as type } from './purge-receipt-type.ts';
import { purgeRecord } from './purge-record.ts';
import { purgeTransientKit } from './purge-transient-kit.ts';
import { quotaRejection } from './quota-rejection.ts';
import { stamp } from './stamp.ts';
import { usageChargeOf } from './usage-charge-of.ts';
import { usageOf } from './usage-of.ts';

const { tenantA, tenantB, backend, deployment } = conformanceScopes;
const stampAfter = (hours: number): Temporal.Instant => stamp.add({ hours });

/**
 * What the adapters count under `core.eventBytes` (12.2): every event and every stream record a
 * unit appends, by the measure of the framework, for its own scope, the change records of receipts
 * included; the unit that removes a record gives its bytes back, by the same measure recomputed from
 * what is stored; a unit is refused only when it declares a limit.
 */
export function storedRecordCases(subject: Pick<ConformanceSubject, 'run' | 'read'>): void {
  const usage = usageOf(subject);
  const { receipts } = purgeTransientKit(subject);
  describe('stored records are counted under core.eventBytes', () => {
    const bytes = 'core.eventBytes';
    const measured = (batch: readonly StreamAppend[]): bigint =>
      batch.reduce(
        (sum, append) => sum + append.events.reduce((all, e) => all + storedEventBytes(e), 0n),
        0n,
      );

    test('every event a unit appends is counted for its scope, by the measure of the framework', async () => {
      const batch = [appendOf(1, [1, 2]), appendOf(2, [3])];
      await subject.run(tenantA, (unit) => unit.events.append(batch));
      expect(await usage(bytes)).toBe(measured(batch));
      expect(measured(batch)).toBeGreaterThan(0n);
      expect(await usage(bytes, tenantB)).toBe(0n);
      const settings = [appendOf(1, [1], {}, 'conf.setting')];
      await subject.run(backend, (unit) => unit.events.append(settings));
      expect(await usage(bytes, backend)).toBe(measured(settings));
      await subject.run(deployment, (unit) =>
        unit.events.append([appendOf(1, [1], {}, 'conf.network')]),
      );
      expect(await usage(bytes, deployment)).toBe(0n);
    });

    test('stream records are counted as stored, the process state cache is not', async () => {
      const records = [{ n: 1 }, { text: 'two' }];
      await subject.run(tenantA, async (unit) => {
        await unit.streams.append('conf.lines', 'k', records);
        await unit.streams.append('kernel:process-state', 'k', [{ v: 1 }]);
      });
      expect(await usage(bytes)).toBe(storedStreamRecordBytes('conf.lines', records));
      expect(storedStreamRecordBytes('conf.lines', records)).toBeGreaterThan(0n);
    });

    test('the change records of receipts are counted like every other event', async () => {
      const receipt = [appendOf(1, [1], { tenancy: 'invocation' }, 'core.commandReceipt')];
      await subject.run(tenantA, (unit) => unit.events.append(receipt));
      expect(measured(receipt)).toBeGreaterThan(0n);
      expect(await usage(bytes)).toBe(measured(receipt));
    });

    test('a unit that declares no limit is never refused, whatever the counter says', async () => {
      await subject.run(tenantA, async (unit) =>
        unit.usage.charge([usageChargeOf(10n, null, bytes)]),
      );
      const batch = [appendOf(1, [1, 2])];
      await subject.run(tenantA, (unit) => unit.events.append(batch));
      expect(await usage(bytes)).toBe(10n + measured(batch));
    });

    test('a unit that declares a limit is refused when its records end above it, and stores nothing', async () => {
      const batch = [appendOf(1, [1])];
      const refused = await quotaRejection(
        subject.run(tenantA, async (unit) => {
          unit.usage.charge([usageChargeOf(0n, 1n, bytes)]);
          await unit.events.append(batch);
        }),
      );
      expect(refused.code).toBe('core.quota_exceeded');
      expect(refused.details).toEqual({
        dimension: bytes,
        limit: 1,
        value: Number(measured(batch)),
      });
      expect(await usage(bytes)).toBe(0n);
      expect(await subject.read(tenantA, (unit) => unit.events.head())).toBeNull();
    });

    test('a savepoint that fails takes back the records it counted', async () => {
      const kept = [appendOf(1, [1])];
      await subject.run(tenantA, async (unit) => {
        await unit.events.append(kept);
        await unit
          .nested(async (inner) => {
            await inner.events.append([appendOf(2, [1, 2, 3])]);
            await inner.streams.append('conf.lines', 'k', [{ n: 1 }]);
            throw new Error('the savepoint fails');
          })
          .catch(() => undefined);
      });
      expect(await usage(bytes)).toBe(measured(kept));
    });
  });

  describe('a removal gives back the bytes it frees, in its own unit', () => {
    const bytes = 'core.eventBytes';
    const lines = 'conf.lines';
    const own = (...events: readonly NewEvent[]): bigint =>
      events.reduce((sum, event) => sum + storedEventBytes(event), 0n);

    test('purgeTransient gives back the change records it deletes and nothing for the newest it keeps', async () => {
      await receipts([1]);
      const records = [1, 2, 3, 4].map((n) => purgeRecord(n, n));
      await subject.run(tenantA, (unit) => unit.events.append([appendPurgeReceipt(1, records)]));
      expect(await usage(bytes)).toBe(own(...records));
      await subject.run(tenantA, (unit) => unit.events.purgeTransient(stampAfter(100), 3, [type]));
      expect(await usage(bytes)).toBe(own(records[3] as NewEvent));
    });

    test('expire gives back the records it removes', async () => {
      const records = [{ n: 1 }, { n: 2, text: 'two' }, { n: 3 }, { n: 4, text: 'four of them' }];
      await subject.run(tenantA, (unit) => unit.streams.append(lines, 'a', records));
      const kept = records.slice(2);
      await subject.run(tenantA, (unit) => unit.streams.expire(lines, { maxPerKey: 2 }, 10));
      expect(await usage(bytes)).toBe(storedStreamRecordBytes(lines, kept));
    });

    test('purgeKeys gives back the records of the keys it removes', async () => {
      const a = [{ n: 1 }, { text: 'two' }];
      const b = [{ n: 3, more: [1, 2, 3] }];
      await subject.run(tenantA, async (unit) => {
        await unit.streams.append(lines, 'a', a);
        await unit.streams.append(lines, 'b', b);
      });
      await subject.run(tenantA, (unit) => unit.streams.purgeKeys(lines, ['a']));
      expect(await usage(bytes)).toBe(storedStreamRecordBytes(lines, b));
    });

    test('purgeKeys of the process state cache moves nothing: it was never charged', async () => {
      await subject.run(tenantA, async (unit) => {
        await unit.streams.append('conf.lines', 'k', [{ n: 1 }]);
        await unit.streams.append('kernel:process-state', 'k', [{ v: 1 }]);
      });
      const before = await usage(bytes);
      await subject.run(tenantA, (unit) => unit.streams.purgeKeys('kernel:process-state', ['k']));
      expect(await usage(bytes)).toBe(before);
    });

    test('a removal of a unit that rolls back gives nothing back', async () => {
      await receipts([1]);
      const records = [1, 2].map((n) => purgeRecord(n, n));
      await subject.run(tenantA, async (unit) => {
        await unit.events.append([appendPurgeReceipt(1, records)]);
        await unit.streams.append(lines, 'a', [{ n: 1 }]);
      });
      const before = await usage(bytes);
      await subject
        .run(tenantA, async (unit) => {
          await unit.events.purgeTransient(stampAfter(100), 10, [type]);
          await unit.streams.purgeKeys(lines, ['a']);
          throw new Error('the unit rolls back');
        })
        .catch(() => undefined);
      expect(await usage(bytes)).toBe(before);
    });

    test('a removal in another scope gives back to that scope only', async () => {
      await subject.run(tenantA, (unit) => unit.streams.append(lines, 'a', [{ n: 1 }]));
      await subject.run(tenantB, (unit) => unit.streams.append(lines, 'a', [{ n: 1 }]));
      await subject.run(tenantB, (unit) => unit.streams.purgeKeys(lines, ['a']));
      expect(await usage(bytes)).toBe(storedStreamRecordBytes(lines, [{ n: 1 }]));
      expect(await usage(bytes, tenantB)).toBe(0n);
    });
  });
}
