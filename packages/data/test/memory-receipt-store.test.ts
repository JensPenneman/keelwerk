import type { Receipt } from '@keelwerk/core';
import { commandReceiptUuid } from '@keelwerk/core';
import { receiptInstantCases } from '@keelwerk/testing';
import { beforeEach, describe, expect, test } from 'vitest';
import { commandReceiptDescriptor } from '../src/sql/postgres/command-receipt-descriptor.ts';
import { failure } from './support/failure.ts';
import { id } from './support/id.ts';
import { openMemory } from './support/memory-fixture.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { stamp } from './support/stamp.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

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
  const memory = openMemory();
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1')));
  expect(await memory.read(tenantScope, (unit) => unit.receipts.get('c1'))).toEqual(receipt('c1'));
  expect(await memory.read(tenantScope, (unit) => unit.receipts.get('c2'))).toBeUndefined();
});

test('the same fingerprint puts again without a change; another fingerprint is a conflict', async () => {
  const memory = openMemory();
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1')));
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1')));
  const mismatch = await failure(
    memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1', { fingerprint: 'f2' }))),
  );
  expect(mismatch).toEqual({ kind: 'conflict', code: 'core.idempotency_mismatch' });
});

test('complete records the outcome and the status; an unknown command is not found', async () => {
  const memory = openMemory();
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
  const memory = openMemory();
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
  const memory = openMemory();
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

test('claim takes over a receipt whose expiry has passed and keeps a live one', async () => {
  const memory = openMemory();
  const kinds = async (fingerprint: string) =>
    memory.run(tenantScope, (unit) => unit.receipts.claim(receipt('c1', { fingerprint })));
  expect(await kinds('f1')).toBe('inserted');
  expect(await kinds('f2')).toBe('exists');
  memory.clock.advance(24 * 60 * 60 * 1000);
  expect(await kinds('f3')).toBe('inserted');
  expect((await memory.read(tenantScope, (unit) => unit.receipts.get('c1')))?.fingerprint).toBe(
    'f3',
  );
});

test('a receipt is the core.commandReceipt row of its scope, in the entity form', async () => {
  const memory = openMemory();
  const entity = commandReceiptDescriptor();
  const scope = tenantScope.level === 'tenant' ? tenantScope.tenantId : '';
  const key = commandReceiptUuid(scope, 'c1');
  await memory.run(tenantScope, (unit) =>
    unit.receipts.put(
      receipt('c1', {
        principalResolver: 'r1',
        principalId: 'p1',
        request: { transport: 'rest', remoteAddress: '10.0.0.1', userAgent: null },
      }),
    ),
  );
  const found = async () =>
    (
      await memory.read(tenantScope, (unit) =>
        unit.rows.find(entity, { where: { op: 'in', field: 'id', value: [key] } }),
      )
    ).rows;
  const [row] = await found();
  expect(row).toEqual({
    id: key,
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    commandId: 'c1',
    action: 'app.note.set',
    fingerprint: 'f1',
    principalResolver: 'r1',
    principalId: 'p1',
    status: 'pending',
    apiVersion: '2026-01-01',
    transport: 'rest',
    remoteAddress: '10.0.0.1',
    expiresAt: stamp.add({ hours: 24 }),
  });
  memory.clock.advance(1000);
  await memory.run(tenantScope, (unit) =>
    unit.receipts.complete('c1', { ok: true, value: 1, effects: [] }),
  );
  expect((await found())[0]).toMatchObject({
    status: 'completed',
    version: 2,
    updatedAt: stamp.add({ seconds: 1 }),
    createdAt: stamp,
  });
  await memory.run(tenantScope, (unit) =>
    unit.receipts.put(receipt('c2', { clientId: 'k', clientSeq: 1 })),
  );
  await memory.run(tenantScope, (unit) => unit.receipts.acknowledge('k', 1));
  const acknowledged = await memory.read(tenantScope, (unit) =>
    unit.rows.find(entity, {
      where: { op: 'in', field: 'id', value: [commandReceiptUuid(scope, 'c2')] },
    }),
  );
  expect(acknowledged.rows[0]).toMatchObject({ version: 2, updatedAt: stamp.add({ seconds: 1 }) });
  expect(acknowledged.rows[0]?.acknowledgedAt).toEqual(stamp.add({ seconds: 1 }));
});

test('taking over an expired receipt takes the next version and keeps its creation time', async () => {
  const memory = openMemory();
  const entity = commandReceiptDescriptor();
  const scope = tenantScope.level === 'tenant' ? tenantScope.tenantId : '';
  await memory.run(tenantScope, (unit) => unit.receipts.put(receipt('c1')));
  await memory.run(tenantScope, (unit) =>
    unit.receipts.complete('c1', { ok: true, value: 1, effects: [] }),
  );
  memory.clock.advance(25 * 60 * 60 * 1000);
  await memory.run(tenantScope, (unit) =>
    unit.receipts.claim(receipt('c1', { fingerprint: 'f2' })),
  );
  const page = await memory.read(tenantScope, (unit) =>
    unit.rows.find(entity, {
      where: { op: 'in', field: 'id', value: [commandReceiptUuid(scope, 'c1')] },
    }),
  );
  expect(page.rows[0]).toMatchObject({
    fingerprint: 'f2',
    status: 'pending',
    version: 3,
    createdAt: stamp,
    updatedAt: stamp.add({ hours: 25 }),
  });
});

test('a deployment unit derives the receipt id from the deployment id', async () => {
  const memory = openMemory();
  await memory.run({ level: 'deployment' }, (unit) => unit.receipts.put(receipt('c1')));
  const page = await memory.read({ level: 'deployment' }, (unit) =>
    unit.rows.find(commandReceiptDescriptor(), {
      where: {
        op: 'in',
        field: 'id',
        value: [commandReceiptUuid('00000000-0000-4000-8000-0000000000d1', 'c1')],
      },
    }),
  );
  expect(page.rows.map((row) => row.commandId)).toEqual(['c1']);
});

// The same instants case the SQL adapters run, on a fresh memory adapter per test.
describe('on the memory adapter', () => {
  let fresh = openMemory();
  beforeEach(() => {
    fresh = openMemory();
  });
  receiptInstantCases({
    clock: {
      now: () => fresh.clock.now(),
      advance: (milliseconds) => fresh.clock.advance(milliseconds),
    },
    run: (scope, fn) => fresh.run(scope, fn),
    read: (scope, fn) => fresh.read(scope, fn),
    setNow: (instant) => fresh.clock.set(instant),
  });
});
