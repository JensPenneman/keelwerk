import type { PrincipalRef, Receipt, ReceiptOutcome, StorageRow } from '@keelwerk/core';
import { memoryCloneValue } from './memory-clone-value.ts';

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** The receipt a stored row holds (15.1.7); the inverse of `memoryReceiptRow`. */
export function memoryReceiptOf(row: StorageRow): Receipt {
  const seq = row.clientSeq;
  const acknowledged = row.acknowledgedAt;
  return {
    commandId: String(row.commandId),
    action: String(row.action),
    fingerprint: String(row.fingerprint),
    principal:
      row.principal === undefined || row.principal === null
        ? null
        : (memoryCloneValue(row.principal) as PrincipalRef),
    principalResolver: text(row.principalResolver),
    principalId: text(row.principalId),
    status: String(row.status) as Receipt['status'],
    outcome:
      row.outcome === undefined || row.outcome === null
        ? null
        : (memoryCloneValue(row.outcome) as ReceiptOutcome),
    apiVersion: String(row.apiVersion),
    request: {
      transport: String(row.transport),
      remoteAddress: text(row.remoteAddress),
      userAgent: text(row.userAgent),
    },
    clientId: text(row.clientId),
    clientSeq: seq === null || seq === undefined ? null : Number(seq),
    expiresAt: row.expiresAt as Temporal.Instant,
    ...(acknowledged === null || acknowledged === undefined
      ? {}
      : { acknowledgedAt: acknowledged as Temporal.Instant }),
  };
}
