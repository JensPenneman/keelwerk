import type { Receipt } from '@keelwerk/core';
import { deriveUuidV8 } from '@keelwerk/core';
import { receiptInstantCases, receiptIsolationCases, receiptStoreCases } from '@keelwerk/testing';
import { expect, test } from 'vitest';
import { failure } from '../support/failure.ts';
import { id } from '../support/id.ts';
import { namespaceScope } from '../support/namespace-scope.ts';
import { stamp } from '../support/stamp.ts';
import { storeSuite } from '../support/store-suite.ts';
import { tenantScope } from '../support/tenant-scope.ts';
import { tenantTwo } from '../support/tenant-two.ts';

const memory = storeSuite();

function receipt(commandId: string, over: Partial<Receipt> = {}): Receipt {
  return {
    commandId,
    action: 'app.note.set',
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
    expiresAt: stamp.add({ hours: 24 }),
    ...over,
  };
}

test('put stores a pending receipt and get reads it back', async () => {
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1')));
  expect(await memory.read(tenantScope, (unit) => unit.receipts.get('c1'))).toEqual(receipt('c1'));
  expect(await memory.read(tenantScope, (unit) => unit.receipts.get('c2'))).toBeUndefined();
});

test('the same fingerprint puts again without a change; another fingerprint is a conflict', async () => {
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1')));
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1')));
  const mismatch = await failure(
    memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1', { fingerprint: 'f2' }))),
  );
  expect(mismatch).toEqual({ kind: 'conflict', code: 'core.idempotency_mismatch' });
});

test('complete records the outcome and the status; an unknown command is not found', async () => {
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1')));
  await memory.run(tenantScope, (unit) =>
    unit.receipts.complete('c1', { ok: true, value: 1, effects: [] }),
  );
  expect(await memory.read(tenantScope, (unit) => unit.receipts.get('c1'))).toMatchObject({
    status: 'completed',
    outcome: { ok: true, value: 1 },
  });
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c2')));
  await memory.run(tenantScope, (unit) =>
    unit.receipts.complete('c2', {
      ok: false,
      error: { kind: 'conflict', code: 'x.y', message: 'm', retryable: false, requestId: 'r' },
    }),
  );
  expect((await memory.read(tenantScope, (unit) => unit.receipts.get('c2')))?.status).toBe(
    'failed',
  );
  expect(
    (
      await failure(
        memory.run(tenantScope, (unit) =>
          unit.receipts.complete('nope', { ok: true, value: 1, effects: [] }),
        ),
      )
    ).kind,
  ).toBe('not_found');
});

test('a receipt belongs to its scope, and a rolled-back unit leaves none', async () => {
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1')));
  expect(await memory.read(tenantTwo, (unit) => unit.receipts.get('c1'))).toBeUndefined();
  await memory.run(tenantTwo, (unit) => unit.receipts.put(receipt('c1', { fingerprint: 'other' })));
  await memory
    .run(tenantScope, async (unit) => {
      await unit.receipts.put(receipt('c3'));
      throw new Error('boom');
    })
    .catch(() => undefined);
  expect(await memory.read(tenantScope, (unit) => unit.receipts.get('c3'))).toBeUndefined();
  expect((await failure(memory.read(namespaceScope, (unit) => unit.receipts.get('c1')))).kind).toBe(
    'forbidden',
  );
});

test("forClient lists a client's receipts after a sequence number, acknowledge stamps them", async () => {
  await memory.run(tenantScope, async (unit) => {
    for (const seq of [3, 1, 2]) {
      await unit.receipts.put(receipt(id(seq).toString(), { clientId: 'k', clientSeq: seq }));
    }
    await unit.receipts.put(receipt('other', { clientId: 'z', clientSeq: 9 }));
  });
  const seqs = (after: number, limit: number): Promise<(number | null)[]> =>
    memory.read(tenantScope, async (unit) =>
      (await unit.receipts.forClient('k', after, limit)).map((r) => r.clientSeq),
    );
  expect(await seqs(0, 10)).toEqual([1, 2, 3]);
  expect(await seqs(1, 1)).toEqual([2]);
  await memory.run(tenantScope, (unit) => unit.receipts.acknowledge('k', 2));
  expect(await seqs(0, 10)).toEqual([1, 2, 3]);
  const stamped = await memory.read(tenantScope, async (unit) =>
    (await unit.receipts.forClient('k', 0, 10)).map((r) => r.acknowledgedAt !== undefined),
  );
  expect(stamped).toEqual([true, true, false]);
  expect(await memory.read(tenantScope, (unit) => unit.receipts.get('other'))).toBeDefined();
});

test('the row carries the UUIDv8 of scope and command id, and completing bumps its version', async () => {
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1')));
  await memory.run(tenantScope, (unit) =>
    unit.receipts.complete('c1', { ok: true, value: 1, effects: [] }),
  );
  const stored = await memory.read(tenantScope, (unit) =>
    unit.db
      .selectFrom('app.core__command_receipt')
      .select(['id', 'version'])
      .where('command_id', '=', 'c1')
      .executeTakeFirstOrThrow(),
  );
  const scope = tenantScope.level === 'tenant' ? tenantScope.tenantId : '';
  expect(stored).toEqual({ id: deriveUuidV8(scope, 'c1'), version: 2 });
});

test('claim inserts the receipt once and answers exists afterwards without changing it', async () => {
  const kinds = await memory.run(tenantScope, async (unit) => ({
    first: await unit.receipts.claim(receipt('c1')),
    second: await unit.receipts.claim(receipt('c1', { fingerprint: 'f2' })),
  }));
  expect(kinds).toEqual({ first: 'inserted', second: 'exists' });
  expect((await memory.read(tenantScope, (unit) => unit.receipts.get('c1')))?.fingerprint).toBe(
    'f1',
  );
  const other = await memory.run(tenantTwo, (unit) => unit.receipts.claim(receipt('c1')));
  expect(other).toBe('inserted');
});

test('claim takes over a receipt whose expiry has passed and keeps a live one', async () => {
  const claim = (fingerprint: string) =>
    memory.run(tenantScope, (unit) => unit.receipts.claim(receipt('c1', { fingerprint })));
  const kept = () =>
    memory.read(tenantScope, async (unit) => (await unit.receipts.get('c1'))?.fingerprint);
  expect(await claim('f1')).toBe('inserted');
  expect(await claim('f2')).toBe('exists');
  expect(await kept()).toBe('f1');
  memory.clock.advance(24 * 60 * 60 * 1000);
  expect(await claim('f3')).toBe('inserted');
  expect(await kept()).toBe('f3');
});

// The shared receipt cases, run against PGlite as against the memory adapter and PostgreSQL.
const subject = {
  clock: { now: () => memory.clock.now(), advance: (ms: number) => memory.clock.advance(ms) },
  run: memory.run,
  read: memory.read,
  setNow: (instant: Temporal.Instant) => memory.clock.set(instant),
};
receiptStoreCases(subject);
receiptIsolationCases(subject);
receiptInstantCases(subject);
