import type { EventWorker, RuntimeServiceContext } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher, retention } from '@keelwerk/events';
import { expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { useEpochKit } from './support/epoch-kit.ts';
import { erasureQueuesApp } from './support/erasure-queues-module.ts';

const { directories } = useEpochKit();

const start = Temporal.Instant.from('2026-11-18T10:00:00Z');
const clock = { now: () => start };
const dispatcher = () => consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });

test("a held tenant's expired receipt is purged while the hold stands; the worker stops only on the signal", {
  timeout: 240_000,
}, async () => {
  const external = { factory: directories.durableFactory(), url: 'pglite' };
  const worker = erasure({ pollMs: 3_600_000 });
  const first = await startTestRuntime(erasureQueuesApp, {
    external,
    clock,
    tenants: ['acme'],
    operators: true,
    workers: true,
    eventWorkers: [dispatcher(), worker],
  });
  directories.track(() => first.stop(1000));
  const operator = createLocalClient(first, { principal: testOperator(), tenant: 'acme' });
  const ada = String(
    (
      (await operator.invoke('probe.enrol', {
        name: 'Ada',
        email: 'held.ada@example.test',
      })) as { personId: string }
    ).personId,
  );
  await directories.backUp();
  // Ada's erasure completes after the backup, so the restore below finds it unfinished for the tenant.
  await operator.invoke(
    'core.eraseSubject',
    { subjectId: ada as never, reason: 'subjectRequest' },
    { prefer: 'async' },
  );
  await first.drainJobs();
  await worker.pass();
  await first.drainJobs();
  const ids = { backendId: first.backendId, tenants: { acme: first.tenants.acme.id } };
  await first.stop(1000);
  directories.release();

  // The restore: the control store keeps the erasure and its completion; the erasure worker is not
  // started, so the tenant stays held. The retention worker runs all the same.
  await directories.restore();
  const purging = retention({ intervalMs: 3_600_000 });
  let given: RuntimeServiceContext | undefined;
  const spy: EventWorker = {
    id: 'test.contextSpy',
    roles: ['work'],
    kind: 'eventWorker',
    provides: [],
    runs: [],
    start: async (context) => {
      given = context;
    },
    stop: async () => undefined,
  };
  const second = await startTestRuntime(erasureQueuesApp, {
    external: { factory: directories.durableFactory(), url: 'pglite' },
    clock,
    tenants: ['acme'],
    operators: true,
    workers: true,
    join: ids,
    eventWorkers: [dispatcher(), purging, spy, { ...erasure(), start: async () => undefined }],
  });
  directories.track(() => second.stop(1000));
  if (given === undefined) throw new Error('the services were not given their context');
  const scope = {
    level: 'tenant',
    backendId: second.backendId,
    tenantId: second.tenants.acme.id,
  } as const;
  const commandId = crypto.randomUUID();
  await second.sealed.unit(second.namespace, scope, (unit) =>
    unit.receipts.put({
      commandId,
      action: 'probe.enrol',
      fingerprint: 'planted',
      principal: null,
      principalResolver: null,
      principalId: null,
      status: 'failed',
      outcome: null,
      apiVersion: second.head,
      request: { transport: 'test', remoteAddress: '203.0.113.7', userAgent: 'probe' },
      clientId: null,
      clientSeq: null,
      expiresAt: start.subtract({ hours: 1 }),
    }),
  );
  // The tenant is held: a call is refused.
  const refused = await createLocalClient(second, {
    principal: testOperator(),
    tenant: 'acme',
  })
    .invoke('probe.enrol', { name: 'Bea', email: 'held.bea@example.test' })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(refused).toMatchObject({ kind: 'unavailable' });
  // The pass reaches the held tenant all the same and purges its expired receipt.
  // (the first pass of the service may have done it already, since it runs without being awaited).
  await purging.pass();
  expect(
    await second.sealed.unit(second.namespace, scope, (unit) => unit.receipts.get(commandId)),
  ).toBeUndefined();
  const runs = await second.control.adapter.unit(
    second.control.namespace,
    { level: 'deployment' },
    async (unit) =>
      (await unit.retentionRuns?.list({
        backendId: second.backendId,
        tenantId: second.tenants.acme.id,
        limit: 10,
      })) ?? [],
  );
  expect(runs.reduce((sum, run) => sum + (run.removed.receipts ?? 0), 0)).toBe(1);
  expect(given.signal.aborted).toBe(false);
  // Held still: the hold lifts only with the erasure's completion, which retention never writes.
  const again = await createLocalClient(second, { principal: testOperator(), tenant: 'acme' })
    .invoke('probe.enrol', { name: 'Cy', email: 'held.cy@example.test' })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(again).toMatchObject({ kind: 'unavailable' });
});
