import type { StreamAppend } from '@keelwerk/core';
import { storedEventBytes, storedStreamRecordBytes } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { quotaRejection } from './quota-rejection.ts';
import { usageChargeOf } from './usage-charge-of.ts';
import { usageOf } from './usage-of.ts';

const { tenantA, tenantB, backend, deployment } = conformanceScopes;

/**
 * What the adapters count under `core.eventBytes` (12.2): every event and every stream record a
 * unit appends, by the measure of the framework, for its own scope; what the framework removes
 * itself is not counted; a unit is refused only when it declares a limit.
 */
export function storedRecordCases(subject: Pick<ConformanceSubject, 'run' | 'read'>): void {
  const usage = usageOf(subject);
  describe('stored records are counted under core.eventBytes', () => {
    const bytes = 'core.eventBytes';
    const measured = (batch: readonly StreamAppend[]): bigint =>
      batch.reduce(
        (sum, append) =>
          sum + append.events.reduce((all, e) => all + storedEventBytes(append.stream.type, e), 0n),
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

    test('stream records are counted as stored; the change records of receipts and the process state cache are not', async () => {
      const records = [{ n: 1 }, { text: 'two' }];
      const receipt = [appendOf(1, [1], { tenancy: 'invocation' }, 'core.commandReceipt')];
      await subject.run(tenantA, async (unit) => {
        await unit.streams.append('conf.lines', 'k', records);
        await unit.streams.append('kernel:process-state', 'k', [{ v: 1 }]);
        await unit.events.append(receipt);
      });
      expect(await usage(bytes)).toBe(storedStreamRecordBytes('conf.lines', records));
      expect(storedStreamRecordBytes('conf.lines', records)).toBeGreaterThan(0n);
      expect(measured(receipt)).toBe(0n);
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
}
