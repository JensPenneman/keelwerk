import type { StorageScope, Unit } from '@keelwerk/core';
import { commandReceiptUuid, isKeelwerkError } from '@keelwerk/core';
import {
  commandReceiptDescriptor,
  conformanceDeploymentId,
  conformanceScopes,
} from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { conformanceReceipt } from './conformance-receipt.ts';
import type { ReceiptStoreSubject } from './receipt-store-subject.ts';

const { tenantA, tenantB, backend, deployment } = conformanceScopes;

const owners: readonly (readonly [string, StorageScope, string])[] = [
  ['tenant A', tenantA, tenantA.tenantId],
  ['tenant B', tenantB, tenantB.tenantId],
  ['the backend', backend, backend.backendId],
  ['the deployment', deployment, conformanceDeploymentId],
];

/**
 * A receipt row belongs to the scope that wrote it (15.1.7): no other scope reads it by id, counts
 * it, sees it in a positioned read, or finds it through the receipt store; a tenant reads neither
 * a backend's nor the deployment's row, and neither of those reads a tenant's.
 */
export function receiptIsolationCases(subject: ReceiptStoreSubject): void {
  describe('receipt rows across tenants, the backend and the deployment', () => {
    const entity = commandReceiptDescriptor();
    const commandOf = (name: string): string => `c-${name}`;
    const seed = async (): Promise<void> => {
      for (const [name, scope] of owners) {
        await subject.run(scope, (unit) =>
          unit.receipts.put(conformanceReceipt(commandOf(name), { clientId: 'k', clientSeq: 1 })),
        );
      }
    };
    /** The rows before `id`, or `not_found` when the scope does not see the row. */
    const countBeforeOf = async (unit: Unit, id: string): Promise<number | 'not_found'> => {
      if (unit.rows.countBefore === undefined) throw new Error('the adapter has no countBefore');
      try {
        return await unit.rows.countBefore(
          entity,
          { where: { op: 'in', field: 'id', value: [id] } },
          id,
        );
      } catch (error) {
        if (isKeelwerkError(error) && error.kind === 'not_found') return 'not_found';
        throw error;
      }
    };
    const seen = (scope: StorageScope, id: string) =>
      subject.read(scope, async (unit) => ({
        found: (
          await unit.rows.find(entity, { where: { op: 'in', field: 'id', value: [id] } })
        ).rows.map((row) => row.id),
        exists: [...(await unit.rows.exists(entity, [id]))],
        before: await countBeforeOf(unit, id),
      }));

    test.each(owners)('a row of %s is read by that scope alone', async (name, owner, scopeId) => {
      await seed();
      const id = commandReceiptUuid(scopeId, commandOf(name));
      expect(await seen(owner, id)).toMatchObject({ found: [id], exists: [id] });
      for (const [otherName, other] of owners) {
        if (otherName === name) continue;
        expect(await seen(other, id), `${otherName} reading ${name}`).toEqual({
          found: [],
          exists: [],
          before: 'not_found',
        });
        expect(
          await subject.read(other, (unit) => unit.receipts.get(commandOf(name))),
          `${otherName} reading ${name} through the store`,
        ).toBeUndefined();
      }
    });

    test('each scope counts and lists its own receipt row only, by filter, by position and by client', async () => {
      await seed();
      for (const [name, scope, scopeId] of owners) {
        const own = commandReceiptUuid(scopeId, commandOf(name));
        const read = await subject.read(scope, async (unit) => ({
          count: await unit.rows.count(entity),
          filtered: await unit.rows.count(entity, { op: 'eq', field: 'clientId', value: 'k' }),
          positioned: (await unit.rows.find(entity, { positioned: true })).rows.map(
            (row) => row.id,
          ),
          byPosition: (await unit.rows.find(entity, { page: { position: 0, limit: 10 } })).rows.map(
            (row) => row.id,
          ),
          clients: (await unit.receipts.forClient('k', 0, 10)).map((receipt) => receipt.commandId),
        }));
        expect(read, name).toEqual({
          count: 1,
          filtered: 1,
          positioned: [own],
          byPosition: [own],
          clients: [commandOf(name)],
        });
      }
    });
  });
}
