import type { LedgerRecord, Scope } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { afterEach, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { lateApp } from './support/erasure-late-app.ts';
import { watchedSink } from './support/watched-sink.ts';

let current: TestRuntime<typeof lateApp> | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

const keyIdOf = (stored: unknown): string =>
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
    JSON.stringify(stored),
  )?.[1] ?? '';

/**
 * ada owns a parcel, bea is another subject. `hook.run` runs in the sink that takes the tombstone
 * of the parcel's key: ada's erasure has not reached the parcel's unit then.
 */
async function boot() {
  const hook: { key?: string; run?: () => Promise<void> } = {};
  const sink = watchedSink(async (records: readonly LedgerRecord[]) => {
    if (!records.some((r) => r.type === 'keyTombstone' && r.keyId === hook.key)) return;
    const { run } = hook;
    delete hook.run;
    await run?.();
  });
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(lateApp, {
    adapter: 'memory',
    operators: true,
    workers: true,
    tenants: ['acme'],
    eventWorkers: [worker],
    ledgers: [sink],
  });
  current = runtime;
  const { acme } = runtime.tenants;
  const scope: Scope = { level: 'tenant', backendId: runtime.backendId, tenantId: acme.id };
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const rowsOf = (entity: string) =>
    runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
      const descriptor = runtime.app.registry.entities.get(entity)?.descriptor;
      if (descriptor === undefined) throw new Error(`no entity ${entity}`);
      return (await unit.rows.find(descriptor, { includeArchived: true, includeErased: true }))
        .rows;
    });
  const id = async (action: string, input: object): Promise<string> =>
    String(((await operator.invoke(action as never, input as never)) as { id: string }).id);
  const ada = await id('late.enrol', { email: 'ada@example.test', token: 'a' });
  const bea = await id('late.enrol', { email: 'bea@example.test', token: 'b' });
  const parcel = await id('late.post', { owner: ada, secret: 'ada parcel' });
  hook.key = keyIdOf((await rowsOf('late.parcel')).find((row) => row.id === parcel)?.secret);
  const commandId = crypto.randomUUID();
  /** A command of bea, through the parcel as her principal (as a session row of hers would be). */
  const sendThroughParcel = () =>
    runtime.invoker.invoke({
      action: 'late.send',
      input: { owner: bea, waybill: 'bea waybill' },
      carrier: testCarrier(acme, testPrincipal(bea, { principalId: parcel })),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId,
    });
  const state = async () => ({
    receipt: (await rowsOf('core.commandReceipt')).find(
      (row) => row.id === commandId || row.commandId === commandId,
    ),
  });
  const erase = async (): Promise<void> => {
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: ada as never, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    await worker.pass();
    await runtime.drainJobs();
  };
  return { hook, operator, parcel, bea, sendThroughParcel, state, erase };
}

test('the receipt of a living subject who acts through a parcel moved to her during the erasure is kept', {
  timeout: 60_000,
}, async () => {
  const booted = await boot();
  let sent: unknown;
  booted.hook.run = async () => {
    await booted.operator.invoke('late.give', {
      id: booted.parcel as never,
      owner: booted.bea as never,
    });
    sent = await booted.sendThroughParcel();
  };

  await booted.erase();

  expect(booted.hook.run).toBeUndefined();
  expect(sent).toMatchObject({ ok: true });
  const { receipt } = await booted.state();
  expect(receipt).toMatchObject({ principalId: booted.parcel });
});

test('control: the same command through a parcel that is not erased leaves its receipt', {
  timeout: 60_000,
}, async () => {
  const booted = await boot();
  await booted.operator.invoke('late.give', {
    id: booted.parcel as never,
    owner: booted.bea as never,
  });
  expect(await booted.sendThroughParcel()).toMatchObject({ ok: true });
  expect((await booted.state()).receipt).toMatchObject({ principalId: booted.parcel });
});
