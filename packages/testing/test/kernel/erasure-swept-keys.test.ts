import type { LedgerRecord, Scope } from '@keelwerk/core';
import { createControlLedger } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { afterEach, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { lateApp } from './support/erasure-late-app.ts';
import { watchedSink } from './support/watched-sink.ts';

let current: TestRuntime<typeof lateApp> | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

/** What a key is made for: the entity of its binding, as the kernel seals a job, a decision, an effect or a receipt. */
const kinds = {
  job: 'core.job',
  decision: 'core.decision',
  effect: 'core.effect',
  receipt: 'core.commandReceipt',
  'an entity the registry does not hold': 'gone.thing',
} as const;

test('the last purge unit sweeps the tombstoned keys of every kind that is not made for a row, and never a row key', {
  timeout: 60_000,
}, async () => {
  const taken: LedgerRecord[] = [];
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(lateApp, {
    adapter: 'memory',
    operators: true,
    workers: true,
    tenants: ['acme'],
    eventWorkers: [worker],
    ledgers: [
      watchedSink((records) => {
        taken.push(...records);
        return Promise.resolve();
      }),
    ],
  });
  current = runtime;
  const tenantId = runtime.tenants.acme.id;
  const scope: Scope = { level: 'tenant', backendId: runtime.backendId, tenantId };
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const inTenant = <T>(fn: Parameters<typeof runtime.adapter.unit<T>>[2]) =>
    runtime.adapter.unit(runtime.namespace, scope, fn);
  const enrolled = async (email: string): Promise<string> =>
    String(((await operator.invoke('late.enrol', { email, token: 't' })) as { id: string }).id);
  const ada = await enrolled('ada@example.test');
  const bea = await enrolled('bea@example.test');
  // Keys of every kind, none of them ada's, and the key of bea's own row (her token).
  const keys: Record<string, string> = {};
  for (const [kind, entity] of Object.entries(kinds)) {
    const sealed = await inTenant((unit) =>
      unit.keys.sealValue({ entity, id: `${kind} id`, field: 'x' }, new TextEncoder().encode(kind)),
    );
    keys[kind] = sealed.keyId;
  }
  const row = await inTenant(async (unit) => {
    const descriptor = runtime.app.registry.entities.get('late.member')?.descriptor;
    if (descriptor === undefined) throw new Error('no entity');
    return (await unit.rows.find(descriptor, {})).rows.find((found) => found.id === bea);
  });
  keys.row = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
    JSON.stringify(row?.token),
  )?.[1] as string;

  await operator.invoke(
    'core.eraseSubject',
    { subjectId: ada as never, reason: 'subjectRequest' } as never,
    { prefer: 'async' },
  );
  await runtime.drainJobs();
  // Tombstones that the control ledger holds after the erasure's own record (another erasure of the tenant, or an earlier pass of this one).
  const ledger = createControlLedger(runtime.control.adapter, runtime.control.namespace);
  for (const keyId of Object.values(keys)) {
    await ledger.append({
      type: 'keyTombstone',
      scopeId: tenantId,
      keyId,
      recordedAt: Temporal.Now.instant().toString(),
      reason: 'erasure',
    });
  }
  await worker.pass();
  await runtime.drainJobs();

  const live = await inTenant((unit) => unit.keys.liveValueKeys(Object.values(keys)));
  expect(live).toEqual([keys.row]);
  const sunk = new Set(
    taken.flatMap((record) => (record.type === 'keyTombstone' ? [record.keyId] : [])),
  );
  // The swept keys went to the sink with their tombstone; the row's key was left as it was.
  for (const kind of Object.keys(kinds)) expect(sunk.has(keys[kind] as string)).toBe(true);
});
