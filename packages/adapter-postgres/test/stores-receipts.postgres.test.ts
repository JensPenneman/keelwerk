// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { Receipt } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { ticket } from './support/store-entities.ts';
import { storeHarness } from './support/store-harness.ts';
import { stamp } from './support/store-rows.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA, scopeB } = testScopes;
const { run, failure, setNow } = storeHarness('stores_receipts');

describe('receipts, serials, usage, buckets', () => {
  const receipt = (commandId: string, over: Partial<Receipt> = {}): Receipt => ({
    commandId,
    action: 'app.ticket.set',
    fingerprint: 'f1',
    principal: null,
    status: 'pending',
    outcome: null,
    apiVersion: '2026-01-01',
    request: { transport: 'rest', remoteAddress: null, userAgent: null },
    clientId: null,
    clientSeq: null,
    expiresAt: stamp.add({ hours: 24 }),
    ...over,
  });

  test('a receipt is kept, completed and acknowledged; another fingerprint is a mismatch', async () => {
    await run(scopeA, (u) => u.receipts.put(receipt('c1', { clientId: 'k', clientSeq: 1 })));
    await run(scopeA, (u) => u.receipts.put(receipt('c1', { clientId: 'k', clientSeq: 1 })));
    const mismatch = await failure(
      run(scopeA, (u) => u.receipts.put(receipt('c1', { fingerprint: 'f2' }))),
    );
    expect(mismatch).toEqual({ kind: 'conflict', code: 'core.idempotency_mismatch' });
    await run(scopeA, (u) => u.receipts.complete('c1', { ok: true, value: 1, effects: [] }));
    setNow(stamp.add({ minutes: 5 }));
    await run(scopeA, (u) => u.receipts.acknowledge('k', 1));
    const kept = await run<Receipt | undefined>(scopeA, (u) => u.receipts.get('c1'));
    expect(kept).toMatchObject({ status: 'completed', outcome: { ok: true, value: 1 } });
    expect(kept?.acknowledgedAt?.equals(stamp.add({ minutes: 5 }))).toBe(true);
    expect(await run(scopeB, (u) => u.receipts.get('c1'))).toBeUndefined();
  });

  test('serials are strictly increasing in commit order across concurrent units', async () => {
    const results: bigint[] = [];
    await Promise.all(
      Array.from({ length: 6 }, () =>
        run<void>(scopeA, async (u) => {
          results.push(await u.serials.next(ticket, 'number', ['box']));
        }),
      ),
    );
    expect(results).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    const rolledBack = await run<bigint>(scopeA, async (u) => {
      await u
        .nested(async (inner) => {
          await inner.serials.next(ticket, 'number', ['box'], 10);
          throw new Error('undo');
        })
        .catch(() => undefined);
      return u.serials.next(ticket, 'number', ['box']);
    });
    expect(rolledBack).toBe(7n);
  });

  test('usage adds and reads; a bucket refills by time and answers retryAfter', async () => {
    expect(
      await run(scopeA, async (u) => [
        await u.usage.add('rows', 5n),
        await u.usage.add('rows', -2n),
      ]),
    ).toEqual([5n, 3n]);
    const limits = { capacity: 2, refillPerSecond: 0.5 };
    const takes = await run<unknown[]>(scopeA, async (u) => [
      await u.buckets.take('k', 1, limits),
      await u.buckets.take('k', 1, limits),
      await u.buckets.take('k', 1, limits),
    ]);
    expect(takes).toEqual([{ ok: true }, { ok: true }, { ok: false, retryAfter: 2 }]);
    setNow(stamp.add({ seconds: 2 }));
    expect(await run(scopeA, (u) => u.buckets.take('k', 1, limits))).toEqual({ ok: true });
    expect(await run(scopeB, (u) => u.buckets.take('k', 2, limits))).toEqual({ ok: true });
  });
});
