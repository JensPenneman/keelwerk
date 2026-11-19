import { describe, expect, test } from 'vitest';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { Registry } from '../registry/registry.ts';
import type { Receipt } from '../storage/receipt.ts';
import type { Unit } from '../storage/unit.ts';
import { completeErasureReceipt } from './complete-erasure-receipt.ts';

const tenantId = '0192f3a0-0000-7000-8000-000000000001';
const record: ErasureRecord = {
  type: 'erasure',
  tenantId,
  subjectId: '0192f3a0-0000-7000-8000-0000000000a1',
  recordedAt: '2026-11-12T08:00:00.000Z',
  requester: { kind: 'operator', id: null, via: 'core.operator' },
  reason: 'subjectRequest',
  commandId: 'c1',
};
const registry = {
  entities: new Map([['core.commandReceipt', { descriptor: { shape: { id: 'shape-1' } } }]]),
  actions: new Map([['core.eraseSubject', { idempotencyWindowMs: 3_600_000 }]]),
} as unknown as Registry;
const context = {
  registry,
  writer: { build: { id: 'b', revision: 1 }, hybridClock: { tick: () => ({}) } },
  clock: { now: () => Temporal.Instant.from('2026-11-12T09:00:00Z') },
} as never;

function receipt(status: Receipt['status'], code?: string, action = 'core.eraseSubject'): Receipt {
  return {
    commandId: 'c1',
    action,
    status,
    outcome:
      code === undefined
        ? null
        : {
            ok: false,
            error: { kind: 'unavailable', code, message: 'm', retryable: true, requestId: 'r' },
          },
  } as unknown as Receipt;
}

/** A unit that records the order of the receipt's lock, its read and its writes. */
function setup(found: Receipt | undefined) {
  const calls: string[] = [];
  const expiries: (Temporal.Instant | undefined)[] = [];
  const unit = {
    scope: { level: 'tenant', backendId: 'b1', tenantId },
    rows: {
      findOne: async (_descriptor: unknown, query: Record<string, unknown>) => {
        calls.push(query.forUpdate === true ? 'lock' : 'read');
        return undefined;
      },
    },
    receipts: {
      get: async () => {
        calls.push('get');
        return found;
      },
      complete: async (_commandId: string, _outcome: unknown, expiresAt?: Temporal.Instant) => {
        calls.push('complete');
        expiries.push(expiresAt);
      },
    },
    events: {
      readStream: async () => [],
      append: async () => {
        calls.push('change');
      },
    },
  } as unknown as Unit;
  return { unit, calls, expiries };
}

describe('completing the receipt of an erasure is a conditional transition', () => {
  test('the receipt row is locked before its status is read', async () => {
    const { unit, calls } = setup(receipt('accepted'));
    await completeErasureReceipt(unit, record, 3, context);
    expect(calls).toEqual(['lock', 'get', 'complete', 'change']);
  });

  test('completing moves the expiry to the completion plus the action window', async () => {
    const { unit, expiries } = setup(receipt('accepted'));
    await completeErasureReceipt(unit, record, 3, context);
    expect(expiries.map(String)).toEqual(['2026-11-12T10:00:00Z']);
  });

  test('a receipt that is completed already, by the other worker, is left: no second change record', async () => {
    const { unit, calls } = setup(receipt('completed'));
    await completeErasureReceipt(unit, record, 3, context);
    expect(calls).toEqual(['lock', 'get']);
  });

  test('a receipt that failed with core.unavailable is completed, one that failed another way is not, and a missing one is not made', async () => {
    const unavailable = setup(receipt('failed', 'core.unavailable'));
    await completeErasureReceipt(unavailable.unit, record, 3, context);
    expect(unavailable.calls).toEqual(['lock', 'get', 'complete', 'change']);
    const other = setup(receipt('failed', 'core.not_found'));
    await completeErasureReceipt(other.unit, record, 3, context);
    expect(other.calls).toEqual(['lock', 'get']);
    const missing = setup(undefined);
    await completeErasureReceipt(missing.unit, record, 3, context);
    expect(missing.calls).toEqual(['lock', 'get']);
  });

  test('a receipt of another action under the same command id is left, accepted or failed with core.unavailable', async () => {
    const accepted = setup(receipt('accepted', undefined, 'shop.charge'));
    await completeErasureReceipt(accepted.unit, record, 3, context);
    expect(accepted.calls).toEqual(['lock', 'get']);
    const unavailable = setup(receipt('failed', 'core.unavailable', 'shop.charge'));
    await completeErasureReceipt(unavailable.unit, record, 3, context);
    expect(unavailable.calls).toEqual(['lock', 'get']);
  });
});
