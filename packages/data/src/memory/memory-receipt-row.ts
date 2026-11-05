import type { Receipt, StorageRow } from '@keelwerk/core';
import { floorInstant } from './floor-instant.ts';
import { memoryCloneValue } from './memory-clone-value.ts';

/**
 * The row a receipt is stored as (15.1.7): the receipt's request flattened into the `transport`,
 * `remoteAddress` and `userAgent` fields and every absent value left out, as the table holds it.
 * Instants are floored to the millisecond, as the table holds them. A new row is version 1; the
 * row that takes over an expired one passes the next `version` and keeps the old `createdAt`.
 */
export function memoryReceiptRow(
  receipt: Receipt,
  id: string,
  now: Temporal.Instant,
  existing?: { readonly createdAt: Temporal.Instant; readonly version: number },
): StorageRow {
  const at = floorInstant(now);
  const row: Record<string, unknown> = {
    id,
    createdAt: existing === undefined ? at : floorInstant(existing.createdAt),
    updatedAt: at,
    version: existing === undefined ? 1 : existing.version + 1,
    commandId: receipt.commandId,
    action: receipt.action,
    fingerprint: receipt.fingerprint,
    status: receipt.status,
    apiVersion: receipt.apiVersion,
    transport: receipt.request.transport,
    expiresAt: floorInstant(receipt.expiresAt),
  };
  const optional: Record<string, unknown> = {
    principal: receipt.principal === null ? null : memoryCloneValue(receipt.principal),
    principalResolver: receipt.principalResolver,
    principalId: receipt.principalId,
    outcome: receipt.outcome === null ? null : memoryCloneValue(receipt.outcome),
    remoteAddress: receipt.request.remoteAddress,
    userAgent: receipt.request.userAgent,
    clientId: receipt.clientId,
    clientSeq: receipt.clientSeq,
    acknowledgedAt:
      receipt.acknowledgedAt === undefined ? undefined : floorInstant(receipt.acknowledgedAt),
  };
  for (const [name, value] of Object.entries(optional)) {
    if (value !== null && value !== undefined) row[name] = value;
  }
  return row;
}
