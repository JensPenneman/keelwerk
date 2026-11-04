import type { Receipt } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { storeHarness } from './support/store-harness.ts';
import { stamp } from './support/store-rows.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA } = testScopes;
const { run, failure } = storeHarness('receipt_claim');

const receipt = (commandId: string): Receipt => ({
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
});

test('a duplicate claim waits on the first unit briefly, then answers core.command_in_progress', async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let claimed: () => void = () => undefined;
  const first = new Promise<void>((resolve) => {
    claimed = resolve;
  });
  const owner = run(scopeA, async (u) => {
    const outcome = await u.receipts.claim(receipt('dup'));
    claimed();
    await held;
    return outcome;
  });
  await first;
  const error = await failure(run(scopeA, (u) => u.receipts.claim(receipt('dup'))));
  expect(error).toEqual({ kind: 'conflict', code: 'core.command_in_progress' });
  release();
  expect(await owner).toBe('inserted');
  expect(await run(scopeA, (u) => u.receipts.claim(receipt('dup')))).toBe('exists');
});
