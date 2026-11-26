import type { EventWorker, RuntimeServiceContext, ScopeLookup } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { ownErasureApp } from './support/own-erasure-module.ts';

test('L1: the run of an erasure uses the target its caller found: a directory that answers once is enough, and the record is not marked finished unfinished', async () => {
  let started: RuntimeServiceContext | undefined;
  const spy: EventWorker = {
    id: 'test.contextSpy',
    roles: ['work'],
    kind: 'eventWorker',
    provides: [],
    runs: [],
    start: async (context) => {
      started = context;
    },
    stop: async () => undefined,
  };
  const runtime = await startTestRuntime(ownErasureApp, {
    adapter: 'memory',
    operators: true,
    workers: true,
    eventWorkers: [spy],
  });
  try {
    const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
    const made = (await operator.invoke('oes.make', { note: 'mine' })) as { itemId: string };
    const itemId = String(made.itemId);
    const asked = { subjectId: itemId, reason: 'operator' as const };
    expect((await operator.attempt('core.eraseSubject', asked)).ok).toBe(true);
    await runtime.drainJobs();
    if (started === undefined) throw new Error('the context spy did not start');
    const real = started.archivedDirectory;
    let calls = 0;
    // The directory answers the first look-up of the tenant and no later one.
    const once: ScopeLookup = {
      ...real,
      tenant: async (id) => {
        calls += 1;
        return calls === 1 ? real.tenant(id) : undefined;
      },
    };
    const worker = erasure({ pollMs: 3_600_000 });
    await worker.start({ ...started, archivedDirectory: once });
    await worker.pass();
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme?.id ?? '',
    } as const;
    const keyLive = await runtime.adapter.unit(
      runtime.namespace,
      scope,
      async (unit) => (await unit.keys.dataKey(itemId, { create: false })) !== undefined,
      { readOnly: true },
    );
    const types = (
      await runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
        { readOnly: true },
      )
    ).map((entry) => (entry.record as { type: string }).type);
    expect(keyLive).toBe(false);
    expect(types).toContain('erasureCompleted');
    await worker.stop(Temporal.Now.instant());
  } finally {
    await runtime.stop();
  }
});
