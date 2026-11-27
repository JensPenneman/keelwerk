import type { Unit } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { afterEach, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { erasureAddedApp } from './support/erasure-grant-apps.ts';
import { jobSpy } from './support/job-spy.ts';

let current: TestRuntime<typeof erasureAddedApp> | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

test("an erased requester's pending erasure of another subject still runs, and its receipt keeps no address or agent", {
  timeout: 120_000,
}, async () => {
  const descriptors = new Map(
    [...erasureAddedApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
  );
  const { spy, factory } = jobSpy((ref) => descriptors.get(ref));
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(erasureAddedApp, {
    tenants: ['acme'],
    operators: true,
    workers: true,
    eventWorkers: [
      consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }),
      worker,
    ],
    external: { factory, url: 'memory://requester' },
  });
  current = runtime;
  const { acme } = runtime.tenants;
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const enrol = async (name: string) =>
    String(
      (
        (await operator.invoke('probe.enrol', { name, email: `${name}@example.test` })) as {
          personId: string;
        }
      ).personId,
    );
  const [requester, other] = [await enrol('ada'), await enrol('bea')];
  const scope = { level: 'tenant', backendId: runtime.backendId, tenantId: acme.id } as const;
  const inTenant = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
    runtime.sealed.unit(runtime.namespace, scope, fn);
  const request = crypto.randomUUID();
  const receiptOf = () => inTenant((unit) => unit.receipts.get(request));
  const erasedAt = async (id: string) => {
    const descriptor = descriptors.get('probe.person');
    if (descriptor === undefined) throw new Error('no probe.person');
    return inTenant(
      async (unit) =>
        (
          await unit.rows.findOne(descriptor, {
            where: { op: 'eq', field: 'id', value: id },
            includeArchived: true,
            includeErased: true,
          })
        )?.kwErasedAt ?? null,
    );
  };

  // The operator's erasure of the requester is recorded; its worker has not run yet.
  await operator.invoke(
    'core.eraseSubject',
    { subjectId: requester as never, reason: 'subjectRequest' } as never,
    { prefer: 'async' },
  );
  await runtime.drainJobs();
  // The requester asks for the erasure of another subject; no worker takes its job yet.
  spy.refuseTake = () => true;
  const base = testCarrier(acme, testPrincipal(requester), '203.0.113.9');
  const accepted = await runtime.invoker.invoke({
    action: 'core.eraseSubject',
    input: { subjectId: other, reason: 'subjectRequest' },
    carrier: { ...base, headers: { ...base.headers, 'user-agent': 'requester/1.0' } },
    requestId: crypto.randomUUID(),
    commandId: request,
    prefer: 'async',
    signal: new AbortController().signal,
  });
  expect(accepted.ok).toBe(true);
  expect(await receiptOf()).toMatchObject({
    status: 'accepted',
    request: { remoteAddress: '203.0.113.9', userAgent: 'requester/1.0' },
  });

  await worker.pass();
  // The requester is erased, and its job of another subject's erasure is still there to run.
  delete spy.refuseTake;
  await runtime.drainJobs();
  await worker.pass();

  expect(await erasedAt(requester)).not.toBeNull();
  expect(await erasedAt(other)).not.toBeNull();
  const receipt = await receiptOf();
  expect(receipt?.status).toBe('completed');
  expect(receipt?.request).toEqual({ transport: 'test', remoteAddress: null, userAgent: null });
  expect(receipt?.principal).toBeNull();
  expect(receipt?.principalId).toBe(requester);
  expect(JSON.stringify(receipt)).not.toContain('203.0.113.9');
  expect(JSON.stringify(receipt)).not.toContain('requester/1.0');
});
