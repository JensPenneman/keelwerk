import type { Receipt } from '@keelwerk/core';
import { liveReceiptExpiry } from './live-receipt-expiry.ts';

/** A pending receipt of `commandId`; `over` replaces members. */
export function conformanceReceipt(commandId: string, over: Partial<Receipt> = {}): Receipt {
  return {
    commandId,
    action: 'conf.owner.set',
    fingerprint: 'f1',
    principal: null,
    principalResolver: null,
    principalId: null,
    status: 'pending',
    outcome: null,
    apiVersion: '2026-01-01',
    request: { transport: 'rest', remoteAddress: null, userAgent: null },
    clientId: null,
    clientSeq: null,
    expiresAt: liveReceiptExpiry,
    ...over,
  };
}
