import type { StorageScope } from '@keelwerk/core';
import { commandReceiptUuid } from '@keelwerk/core';
import {
  commandReceiptDescriptor,
  conformanceDeploymentId,
  conformanceScopes,
} from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { conformanceReceipt } from './conformance-receipt.ts';
import { failureOf } from './failure-of.ts';
import type { ReceiptStoreSubject } from './receipt-store-subject.ts';

const { tenantA, backend, deployment } = conformanceScopes;

/** The receipt cases (15.1.7), shared by every adapter: the stores, the entity reads and the row's version stamps. */
export function receiptStoreCases(subject: ReceiptStoreSubject): void {
  describe('receipts (15.1.7)', () => {
    test('put is idempotent for one fingerprint and a conflict for another; complete records the outcome', async () => {
      await subject.run(tenantA, (unit) => unit.receipts.put(conformanceReceipt('c1')));
      await subject.run(tenantA, (unit) => unit.receipts.put(conformanceReceipt('c1')));
      const other = subject.run(tenantA, (unit) =>
        unit.receipts.put(conformanceReceipt('c1', { fingerprint: 'f2' })),
      );
      expect((await failureOf(other)).kind).toBe('conflict');
      await subject.run(tenantA, (unit) =>
        unit.receipts.complete('c1', { ok: true, value: 1, effects: [] }),
      );
      expect(await subject.read(tenantA, (unit) => unit.receipts.get('c1'))).toMatchObject({
        status: 'completed',
        outcome: { ok: true, value: 1 },
      });
      expect(await subject.read(tenantA, (unit) => unit.receipts.get('nope'))).toBeUndefined();
      const unknown = subject.run(tenantA, (unit) =>
        unit.receipts.complete('nope', { ok: true, value: 1, effects: [] }),
      );
      expect((await failureOf(unknown)).kind).toBe('not_found');
    });

    test('a claim takes over a receipt whose expiry has passed, a put does not, and both keep a live one', async () => {
      const expired = Temporal.Instant.fromEpochMilliseconds(0);
      const kept = () =>
        subject.read(tenantA, async (unit) => (await unit.receipts.get('c1'))?.fingerprint);
      await subject.run(tenantA, (unit) =>
        unit.receipts.put(conformanceReceipt('c1', { expiresAt: expired })),
      );
      const refused = subject.run(tenantA, (unit) =>
        unit.receipts.put(conformanceReceipt('c1', { fingerprint: 'f2', expiresAt: expired })),
      );
      expect(await failureOf(refused)).toEqual({
        kind: 'conflict',
        code: 'core.idempotency_mismatch',
      });
      expect(
        await subject.run(tenantA, (unit) =>
          unit.receipts.claim(conformanceReceipt('c1', { fingerprint: 'f2', expiresAt: expired })),
        ),
      ).toBe('inserted');
      expect(await kept()).toBe('f2');
      await subject.run(tenantA, (unit) => unit.receipts.put(conformanceReceipt('c2')));
      const mismatch = subject.run(tenantA, (unit) =>
        unit.receipts.put(conformanceReceipt('c2', { fingerprint: 'f2' })),
      );
      expect(await failureOf(mismatch)).toEqual({
        kind: 'conflict',
        code: 'core.idempotency_mismatch',
      });
    });

    test('core.commandReceipt rows are read by the derived id: system columns, count, exists, filter', async () => {
      const entity = commandReceiptDescriptor();
      const id = commandReceiptUuid(tenantA.tenantId, 'c1');
      const find = () =>
        subject.read(tenantA, (unit) =>
          unit.rows.find(entity, {
            where: { op: 'in', field: 'id', value: [id] },
            positioned: true,
          }),
        );
      await subject.run(tenantA, (unit) =>
        unit.receipts.put(
          conformanceReceipt('c1', {
            principalResolver: 'r1',
            principalId: 'p1',
            principal: { resolver: 'r1', principalId: 'p1' },
          }),
        ),
      );
      const pending = await find();
      expect(pending.rows).toHaveLength(1);
      expect(pending.rows[0]).toMatchObject({
        id,
        commandId: 'c1',
        status: 'pending',
        principalResolver: 'r1',
        principalId: 'p1',
        version: 1,
      });
      expect(pending.rows[0]).not.toHaveProperty('archivedAt');
      await subject.run(tenantA, (unit) =>
        unit.receipts.complete('c1', { ok: true, value: 1, effects: [] }),
      );
      expect((await find()).rows[0]).toMatchObject({ status: 'completed', version: 2 });
      expect(await subject.read(tenantA, (unit) => unit.rows.count(entity))).toBe(1);
      expect(
        await subject.read(tenantA, (unit) =>
          unit.rows.count(entity, { op: 'eq', field: 'principalId', value: 'p1' }),
        ),
      ).toBe(1);
      expect(
        await subject.read(tenantA, (unit) =>
          unit.rows.count(entity, { op: 'eq', field: 'principalId', value: 'other' }),
        ),
      ).toBe(0);
      expect([...(await subject.read(tenantA, (unit) => unit.rows.exists(entity, [id])))]).toEqual([
        id,
      ]);
    });

    test.each([
      ['backend', backend, conformanceScopes.backend.backendId],
      ['deployment', deployment, conformanceDeploymentId],
    ] as const)(
      'a %s receipt is read from its own scope by the id of that scope',
      async (_name, scope: StorageScope, scopeId) => {
        const entity = commandReceiptDescriptor();
        await subject.run(scope, (unit) => unit.receipts.put(conformanceReceipt('c1')));
        const id = commandReceiptUuid(scopeId, 'c1');
        const page = await subject.read(scope, (unit) =>
          unit.rows.find(entity, { where: { op: 'in', field: 'id', value: [id] } }),
        );
        expect(page.rows.map((row) => row.commandId)).toEqual(['c1']);
        expect(page.rows[0]?.id).toBe(id);
      },
    );

    test('forClient lists after a sequence number in order; acknowledge marks the receipts and keeps them', async () => {
      await subject.run(tenantA, async (unit) => {
        for (const seq of [3, 1, 2]) {
          await unit.receipts.put(
            conformanceReceipt(`seq-${seq}`, { clientId: 'k', clientSeq: seq }),
          );
        }
        await unit.receipts.put(conformanceReceipt('other', { clientId: 'z', clientSeq: 9 }));
      });
      const listAfter = async (seq: number) =>
        (await subject.read(tenantA, (unit) => unit.receipts.forClient('k', seq, 10))).map(
          (r) => r.commandId,
        );
      expect(await listAfter(0)).toEqual(['seq-1', 'seq-2', 'seq-3']);
      expect(await listAfter(1)).toEqual(['seq-2', 'seq-3']);
      expect(
        (await subject.read(tenantA, (unit) => unit.receipts.forClient('k', 0, 2))).map(
          (r) => r.commandId,
        ),
      ).toEqual(['seq-1', 'seq-2']);
      await subject.run(tenantA, (unit) => unit.receipts.acknowledge('k', 2));
      const kept = await subject.read(tenantA, (unit) => unit.receipts.forClient('k', 0, 10));
      expect(kept.map((r) => [r.commandId, r.acknowledgedAt !== undefined])).toEqual([
        ['seq-1', true],
        ['seq-2', true],
        ['seq-3', false],
      ]);
      expect(
        (await subject.read(tenantA, (unit) => unit.receipts.get('other')))?.acknowledgedAt,
      ).toBeUndefined();
    });
    const entity = commandReceiptDescriptor();
    const expired = Temporal.Instant.fromEpochMilliseconds(0);
    const clockOf = () => {
      if (subject.clock === undefined) throw new Error('the receipt cases need the adapter clock');
      return subject.clock;
    };
    const rowOf = (commandId: string) =>
      subject.read(tenantA, async (unit) => {
        const page = await unit.rows.find(entity, {
          where: {
            op: 'in',
            field: 'id',
            value: [commandReceiptUuid(tenantA.tenantId, commandId)],
          },
        });
        const row = page.rows[0];
        if (row === undefined) throw new Error(`no receipt row for ${commandId}`);
        return {
          version: Number(row.version),
          createdAt: row.createdAt as Temporal.Instant,
          updatedAt: row.updatedAt as Temporal.Instant,
          acknowledgedAt: row.acknowledgedAt as Temporal.Instant | undefined,
          fingerprint: String(row.fingerprint),
          status: String(row.status),
        };
      });
    /** The row stamped by `change` carries the next version and an `updatedAt` read off the clock, whole milliseconds, with `createdAt` kept. */
    const stampedBy = async (commandId: string, change: () => Promise<unknown>) => {
      const first = await rowOf(commandId);
      clockOf().advance(1000);
      const before = clockOf().now();
      await change();
      const after = clockOf().now();
      const next = await rowOf(commandId);
      expect(next.version).toBe(first.version + 1);
      expect(next.createdAt.equals(first.createdAt)).toBe(true);
      expect(next.updatedAt.epochNanoseconds % 1_000_000n).toBe(0n);
      expect(next.updatedAt.epochMilliseconds).toBeGreaterThanOrEqual(before.epochMilliseconds);
      expect(next.updatedAt.epochMilliseconds).toBeLessThanOrEqual(after.epochMilliseconds);
      expect(next.updatedAt.epochMilliseconds).toBeGreaterThan(first.updatedAt.epochMilliseconds);
      return next;
    };

    test('a claim that takes over a completed expired receipt takes the next version and a new updatedAt, and keeps createdAt', async () => {
      await subject.run(tenantA, (unit) =>
        unit.receipts.put(conformanceReceipt('c1', { expiresAt: expired })),
      );
      await subject.run(tenantA, (unit) =>
        unit.receipts.complete('c1', { ok: true, value: 1, effects: [] }),
      );
      const taken = await stampedBy('c1', () =>
        subject.run(tenantA, (unit) =>
          unit.receipts.claim(conformanceReceipt('c1', { fingerprint: 'f2' })),
        ),
      );
      expect(taken).toMatchObject({ version: 3, fingerprint: 'f2', status: 'pending' });
    });

    test('a claim that takes over an expired receipt takes the next version and a new updatedAt, and keeps createdAt', async () => {
      await subject.run(tenantA, (unit) =>
        unit.receipts.put(conformanceReceipt('c1', { expiresAt: expired })),
      );
      const taken = await stampedBy('c1', async () =>
        expect(
          await subject.run(tenantA, (unit) =>
            unit.receipts.claim(conformanceReceipt('c1', { fingerprint: 'f2' })),
          ),
        ).toBe('inserted'),
      );
      expect(taken).toMatchObject({ version: 2, fingerprint: 'f2', status: 'pending' });
    });

    test('acknowledge takes the next version and a new updatedAt, so a conditional read sees the change', async () => {
      await subject.run(tenantA, (unit) =>
        unit.receipts.put(conformanceReceipt('c1', { clientId: 'k', clientSeq: 1 })),
      );
      const acknowledged = await stampedBy('c1', () =>
        subject.run(tenantA, (unit) => unit.receipts.acknowledge('k', 1)),
      );
      expect(acknowledged.version).toBe(2);
      expect(acknowledged.acknowledgedAt?.equals(acknowledged.updatedAt)).toBe(true);
    });
  });
}
