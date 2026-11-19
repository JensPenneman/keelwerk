import type { Condition, Registry, Unit } from '@keelwerk/core';
import { receiptValueKeys } from '@keelwerk/core';

const receiptRef = 'core.commandReceipt';

/**
 * Deletes, in the caller's writing unit, the receipts of the unit's scope that are finished
 * (`completed` or `failed`) and whose `expiresAt` is before `now`, at most `limit`, and destroys
 * the value keys of their outcomes in the same unit. Receipts are selected by status, expiry and
 * the client's acknowledgement: nothing here reads the fingerprint. A receipt of a sync mutation
 * (it names a client) stays until that client has acknowledged it, whatever its expiry. The rows
 * are locked first, so a takeover of the same expired receipt waits for this unit or finds the row
 * gone. A receipt that is still `pending` or `accepted` stays, whatever its expiry, until it
 * finishes. Answers the rows found (a full page means more may wait), the receipts purged, the
 * value keys destroyed and `more`: whether a finished receipt that is past its expiry is left. A
 * short page proves nothing about that, because the locking read skips rows another pass deleted
 * while it waited, so after a short page a read of its own, which sees what others committed,
 * answers; rows another pass is still deleting count as left.
 */
export async function purgeExpiredReceipts(
  unit: Unit,
  registry: Registry,
  now: Temporal.Instant,
  limit: number,
): Promise<{
  readonly found: number;
  readonly receipts: number;
  readonly valueKeys: number;
  readonly more: boolean;
}> {
  const entry = registry.entities.get(receiptRef);
  if (entry === undefined) return { found: 0, receipts: 0, valueKeys: 0, more: false };
  const where: Condition = {
    op: 'and',
    conditions: [
      { op: 'in', field: 'status', value: ['completed', 'failed'] },
      { op: 'lt', field: 'expiresAt', value: now },
      // A sync mutation's receipt stays until its client has acknowledged it (7.5, 15.3.6).
      {
        op: 'or',
        conditions: [
          { op: 'isNull', field: 'clientId', value: true },
          { op: 'isNull', field: 'acknowledgedAt', value: false },
        ],
      },
    ],
  };
  const page = await unit.rows.find(entry.descriptor, {
    where,
    select: ['id', 'commandId', 'action', 'outcome'],
    page: { first: limit },
    includeArchived: true,
    includeErased: true,
    forUpdate: true,
  });
  const found = page.rows.length;
  const purged = async () => {
    if (found === 0) return { receipts: 0, valueKeys: 0 };
    const keyIds = await receiptValueKeys(unit, registry, page.rows);
    for (const keyId of keyIds) await unit.keys.destroyValueKey(keyId);
    const receipts = await unit.rows.purge(
      entry.descriptor,
      page.rows.map((row) => String(row.id)),
    );
    return { receipts, valueKeys: keyIds.length };
  };
  const { receipts, valueKeys } = await purged();
  if (found === limit) return { found, receipts, valueKeys, more: true };
  const left = await unit.rows.find(entry.descriptor, {
    where,
    select: ['id'],
    page: { first: 1 },
    includeArchived: true,
    includeErased: true,
  });
  return { found, receipts, valueKeys, more: left.rows.length > 0 };
}
