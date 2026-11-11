import { describe, expect, test } from 'vitest';
import type { JobRetry } from '../jobs/job-retry.ts';
import type { Scope } from '../storage/scope.ts';
import { defaultReceiptWindowMs } from './default-receipt-window-ms.ts';
import { receiptWindowMs } from './receipt-window-ms.ts';

const tenant: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const backend: Scope = { level: 'backend', backendId: 'b1' };
const day = 24 * 60 * 60 * 1000;

describe('the receipt window of a command', () => {
  test('a command that runs in its own scope keeps its action window', () => {
    expect(
      receiptWindowMs(
        { scope: 'backend', idempotencyWindowMs: 1000 },
        { scope: backend, retry: { delays: 'exponential', giveUpAfter: '72h' } },
      ),
    ).toBe(1000);
    expect(receiptWindowMs({ scope: 'backend' }, undefined)).toBeUndefined();
  });

  test('a job that crosses scopes keeps a receipt for the default window at least', () => {
    expect(
      receiptWindowMs({ scope: 'backend', idempotencyWindowMs: 1000 }, { scope: tenant }),
    ).toBe(defaultReceiptWindowMs);
    expect(
      receiptWindowMs({ scope: 'backend', idempotencyWindowMs: 3 * day }, { scope: tenant }),
    ).toBe(3 * day);
  });

  test('a retry policy longer than a day lengthens the receipt of a job that crosses scopes', () => {
    const giveUp: JobRetry = { delays: 'exponential', giveUpAfter: '72h' };
    expect(receiptWindowMs({ scope: 'backend' }, { scope: tenant, retry: giveUp })).toBe(3 * day);
    const counted: JobRetry = { delays: ['12h'], limit: 5, maxDelay: '12h' };
    expect(receiptWindowMs({ scope: 'backend' }, { scope: tenant, retry: counted })).toBe(
      5 * 12 * 60 * 60 * 1000,
    );
  });
});
