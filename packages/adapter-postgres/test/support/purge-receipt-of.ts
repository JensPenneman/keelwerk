import type { Receipt } from '@keelwerk/core';

/** A completed receipt of `commandId` that no test lets expire. */
export function purgeReceiptOf(commandId: string): Receipt {
  return {
    commandId,
    action: 'app.ticket.set',
    fingerprint: 'f1',
    principal: null,
    principalResolver: null,
    principalId: null,
    status: 'completed',
    outcome: { ok: true, value: 1, effects: [] },
    apiVersion: '2026-01-01',
    request: { transport: 'rest', remoteAddress: null, userAgent: null },
    clientId: null,
    clientSeq: null,
    expiresAt: Temporal.Instant.from('2099-01-01T00:00:00Z'),
  };
}
