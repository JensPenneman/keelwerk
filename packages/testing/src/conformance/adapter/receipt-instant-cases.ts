import { commandReceiptUuid } from '@keelwerk/core';
import { commandReceiptDescriptor, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { conformanceReceipt } from './conformance-receipt.ts';
import type { ReceiptStoreSubject } from './receipt-store-subject.ts';

const { tenantA } = conformanceScopes;

/**
 * Receipt instants are whole milliseconds on every adapter (14.5.3): under a clock with sub-
 * millisecond readings and receipts carrying sub-millisecond instants, the stored row is the same
 * literal row on memory, PGlite and PostgreSQL.
 */
export function receiptInstantCases(
  subject: ReceiptStoreSubject & { setNow(instant: Temporal.Instant): void },
): void {
  describe('receipt instants under a sub-millisecond clock', () => {
    test('the stored row is the same whole-millisecond row on every adapter', async () => {
      const entity = commandReceiptDescriptor();
      const id = commandReceiptUuid(tenantA.tenantId, 'c1');
      subject.setNow(Temporal.Instant.from('2026-03-04T05:06:07.123456789Z'));
      await subject.run(tenantA, (unit) =>
        unit.receipts.put(
          conformanceReceipt('c1', {
            expiresAt: Temporal.Instant.from('2026-03-05T05:06:07.987654321Z'),
            acknowledgedAt: Temporal.Instant.from('2026-03-04T05:06:07.555555555Z'),
          }),
        ),
      );
      const rowAt = async () =>
        subject.read(tenantA, async (unit) => {
          const page = await unit.rows.find(entity, {
            where: { op: 'in', field: 'id', value: [id] },
          });
          return page.rows[0];
        });
      const created = {
        id,
        createdAt: Temporal.Instant.from('2026-03-04T05:06:07.123Z'),
        updatedAt: Temporal.Instant.from('2026-03-04T05:06:07.123Z'),
        version: 1,
        commandId: 'c1',
        action: 'conf.owner.set',
        fingerprint: 'f1',
        status: 'pending',
        apiVersion: '2026-01-01',
        transport: 'rest',
        expiresAt: Temporal.Instant.from('2026-03-05T05:06:07.987Z'),
        acknowledgedAt: Temporal.Instant.from('2026-03-04T05:06:07.555Z'),
      };
      expect(await rowAt()).toEqual(created);
      subject.setNow(Temporal.Instant.from('2026-03-04T05:06:09.999999999Z'));
      await subject.run(tenantA, (unit) =>
        unit.receipts.complete('c1', { ok: true, value: 1, effects: [] }),
      );
      expect(await rowAt()).toEqual({
        ...created,
        updatedAt: Temporal.Instant.from('2026-03-04T05:06:09.999Z'),
        version: 2,
        status: 'completed',
        outcome: { ok: true, value: 1, effects: [] },
      });
      expect(
        (await subject.read(tenantA, (unit) => unit.receipts.get('c1')))?.expiresAt.toString(),
      ).toBe('2026-03-05T05:06:07.987Z');
    });
  });
}
