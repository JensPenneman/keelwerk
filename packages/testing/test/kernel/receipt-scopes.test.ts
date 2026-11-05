import type { Carrier, DataAdapter, NamespaceRef, Receipt, StorageScope } from '@keelwerk/core';
import { commandReceiptId, commandReceiptUuid, deriveEffectId } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { describe, expect, test } from 'vitest';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { testPrincipalHeader } from '../../src/harness/test-principal-header.ts';
import { call, local, operatorHost, testClock } from './support/core-actions-kit.ts';
import { command, effectsKit, registryWith } from './support/effects-kit.ts';
import { tenant as sessionTenant } from './support/run-read-kit.ts';
import { boot, deploymentOf } from './support/runtime-kit.ts';

const ada = JSON.stringify(testPrincipal('ada'));
const adaIn = (headers: Record<string, string>): Carrier => ({
  transport: 'test',
  headers: { [testPrincipalHeader]: ada, ...headers },
});

function receiptOf(commandId: string, resolver: string, principalId: string): Receipt {
  return {
    commandId,
    action: 'library.addBook',
    fingerprint: 'f',
    principal: null,
    principalResolver: resolver,
    principalId,
    status: 'accepted',
    outcome: null,
    apiVersion: '2026-11-04',
    request: { transport: 'test', remoteAddress: null, userAgent: null },
    clientId: null,
    clientSeq: null,
    expiresAt: Temporal.Instant.from('2027-01-01T00:00:00Z'),
  };
}

/** A memory adapter that remembers the unit scopes it served and the deployment id, so a test can put a receipt where a command would have. */
function spied() {
  const real = memoryAdapter();
  const seen = new Map<
    string,
    { adapter: DataAdapter; namespace: NamespaceRef; scope: StorageScope }
  >();
  let deploymentId = '';
  return {
    factory: {
      ...real,
      create: (...args: Parameters<typeof real.create>) => {
        const adapter = real.create(...args);
        deploymentId = args[1].deploymentId;
        const open = adapter.unit.bind(adapter);
        adapter.unit = (namespace, scope, fn, options) => {
          if (scope.level === 'deployment') seen.set('deployment', { adapter, namespace, scope });
          else seen.set('placement', { adapter, namespace, scope });
          return open(namespace, scope, fn, options);
        };
        return adapter;
      },
    },
    deployment: () => deploymentId,
    put: async (key: string, receipt: Receipt) => {
      const hit = seen.get(key === 'deployment' ? key : 'placement');
      if (hit === undefined) throw new Error(`no unit was opened at ${key}`);
      const [level, first, second] = key.split(':');
      const scope: StorageScope =
        level === 'backend' && first !== undefined
          ? { level: 'backend', backendId: first }
          : level === 'tenant' && first !== undefined && second !== undefined
            ? { level: 'tenant', backendId: first, tenantId: second }
            : hit.scope;
      await hit.adapter.unit(hit.namespace, scope, async (unit) => {
        await unit.receipts.put(receipt);
      });
    },
  };
}

async function started() {
  const spy = spied();
  const runtime = await boot(
    deploymentOf('memory', {
      factory: spy.factory,
      operator: { hosts: [operatorHost] },
      tenantResolution: [{ kind: 'header', header: 'x-tenant', backendHeader: 'x-backend' }],
    }),
    { clock: testClock().clock },
  );
  const backend = await runtime.control.createBackend({
    name: 'library',
    app: 'library',
    placement: 'main',
  });
  await call(runtime.invoker, adaIn({ 'x-backend': backend.id }), 'core.commandReceipt.get', {
    ids: [commandReceiptUuid(backend.id, 'warm')],
  });
  return { spy, runtime, backend };
}

describe('reads of an invocation entity accept every session level in its own scope (S-102)', () => {
  test('an operator at deployment scope reads a deployment receipt', async () => {
    const { spy, runtime } = await started();
    await spy.put('deployment', receiptOf('d1', 'core.operator', 'local.in-process'));
    const id = commandReceiptUuid(spy.deployment(), 'd1');
    const read = await call(runtime.invoker, local, 'core.commandReceipt.get', { ids: [id] });
    expect(read).toMatchObject({
      ok: true,
      value: { list: [{ commandId: 'd1', status: 'accepted' }], notFound: [] },
    });
    const other = await call(runtime.invoker, local, 'core.commandReceipt.get', {
      ids: [commandReceiptUuid(spy.deployment(), 'unknown')],
    });
    expect(other).toMatchObject({ ok: true, value: { list: [], notFound: [expect.any(String)] } });
  });

  test('a backend session reads its backend receipt', async () => {
    const { spy, runtime, backend } = await started();
    await spy.put(`backend:${backend.id}`, receiptOf('b1', 'test.principal', 'ada'));
    const carrier = adaIn({ 'x-backend': backend.id });
    const id = commandReceiptUuid(backend.id, 'b1');
    const read = await call(runtime.invoker, carrier, 'core.commandReceipt.get', { ids: [id] });
    expect(read).toMatchObject({
      ok: true,
      value: { list: [{ commandId: 'b1', status: 'accepted' }], notFound: [] },
    });
  });

  test('reads across scopes answer core.not_found', async () => {
    const { spy, runtime, backend } = await started();
    await spy.put('deployment', receiptOf('d1', 'test.principal', 'ada'));
    await spy.put(`backend:${backend.id}`, receiptOf('b1', 'test.principal', 'ada'));
    const carrier = adaIn({ 'x-backend': backend.id });
    const deploymentId = commandReceiptUuid(spy.deployment(), 'd1');
    const backendId = commandReceiptUuid(backend.id, 'b1');
    const fromBackend = await call(runtime.invoker, carrier, 'core.commandReceipt.get', {
      ids: [deploymentId],
    });
    expect(fromBackend).toMatchObject({
      ok: true,
      value: { list: [], notFound: [expect.any(String)] },
    });
    const fromDeployment = await call(runtime.invoker, local, 'core.commandReceipt.get', {
      ids: [backendId],
    });
    expect(fromDeployment).toMatchObject({
      ok: true,
      value: { list: [], notFound: [expect.any(String)] },
    });
  });

  test('a backend session reading a tenant receipt of its own backend gets notFound', async () => {
    const { spy, runtime, backend } = await started();
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 'acme' });
    await spy.put(`tenant:${backend.id}:${tenant.id}`, receiptOf('t1', 'test.principal', 'ada'));
    const read = await call(
      runtime.invoker,
      adaIn({ 'x-backend': backend.id }),
      'core.commandReceipt.get',
      { ids: [commandReceiptUuid(tenant.id, 't1')] },
    );
    expect(read).toMatchObject({ ok: true, value: { list: [], notFound: [expect.any(String)] } });
  });

  test('core.effect.get reaches its rules at backend and at deployment scope, where no rule allows a read (S-102)', async () => {
    const { runtime, backend } = await started();
    const atBackend = await call(
      runtime.invoker,
      { ...local, headers: { 'x-backend': backend.id } },
      'core.effect.get',
      { ids: [deriveEffectId({ level: 'backend', backendId: backend.id }, 'c1', 0)] },
    );
    const atDeployment = await call(runtime.invoker, local, 'core.effect.get', {
      ids: [deriveEffectId({ level: 'deployment' }, 'c1', 0)],
    });
    // Past the scope gate (the action runs at every level) the answer is the empty rule set: the core module grants no read of effects.
    for (const answer of [atBackend, atDeployment]) {
      expect(answer).toMatchObject({
        ok: false,
        error: { kind: 'forbidden', code: 'core.forbidden', rules: [] },
      });
    }
  });
});

describe('the receipt id an accepted command answers with (S-102)', () => {
  const registry = registryWith({
    actions: [
      command('slow', () => [], { execution: 'async' }),
      command('fast', () => [], { execution: 'sync' }),
      command('backendSlow', () => [], { execution: 'async', scope: 'backend' }),
    ],
  });
  const tenantScopeId = sessionTenant.level === 'tenant' ? sessionTenant.tenantId : '';

  test('a command whose receipt is in the session scope answers with the id core.commandReceipt.get reads it by', async () => {
    const { invoke } = effectsKit(registry);
    const outcome = await invoke('library.slow', {}, { commandId: 'a1' });
    expect(outcome).toMatchObject({ ok: true, receipt: { commandId: 'a1', status: 'accepted' } });
    expect(outcome.ok && outcome.receiptId).toBe(commandReceiptId(tenantScopeId, 'a1'));
  });

  test('a retry answers with the same id', async () => {
    const { invoke } = effectsKit(registry);
    await invoke('library.slow', {}, { commandId: 'a1' });
    const again = await invoke('library.slow', {}, { commandId: 'a1' });
    expect(again.ok && again.receiptId).toBe(commandReceiptId(tenantScopeId, 'a1'));
  });

  test('a receipt in another scope than the session is not offered', async () => {
    const { invoke } = effectsKit(registry);
    const outcome = await invoke('library.backendSlow', {}, { commandId: 'b1' });
    expect(outcome).toMatchObject({ ok: true, receipt: { commandId: 'b1', status: 'accepted' } });
    expect(outcome.ok && outcome.receiptId).toBeUndefined();
  });

  test('a command that ran at once has no receipt id', async () => {
    const { invoke } = effectsKit(registry);
    const outcome = await invoke('library.fast', {}, { commandId: 's1' });
    expect(outcome).toMatchObject({ ok: true });
    expect(outcome.ok && outcome.receiptId).toBeUndefined();
  });
});
