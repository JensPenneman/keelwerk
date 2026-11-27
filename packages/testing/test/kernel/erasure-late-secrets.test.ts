import type { LedgerRecord, Scope } from '@keelwerk/core';
import { deriveEffectId } from '@keelwerk/core';
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

/** The id of the value key a stored secret names (`kwv1.<key id>.…`, or the object form). */
function valueKeyIdOf(stored: unknown): string {
  const found = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
    JSON.stringify(stored),
  );
  if (found?.[1] === undefined) throw new Error(`no value key id in ${JSON.stringify(stored)}`);
  return found[1];
}

async function boot(
  watch: (records: readonly LedgerRecord[]) => Promise<void> = async () => {},
  adapter: 'memory' | 'pglite' = 'memory',
) {
  const taken: LedgerRecord[] = [];
  const sink = watchedSink(async (records) => {
    taken.push(...records);
    await watch(records);
  });
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(lateApp, {
    adapter,
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
  const rowOf = (entity: string, id: string) =>
    runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
      const descriptor = runtime.app.registry.entities.get(entity)?.descriptor;
      if (descriptor === undefined) throw new Error(`no entity ${entity}`);
      return (
        await unit.rows.find(descriptor, { includeArchived: true, includeErased: true })
      ).rows.find((row) => row.id === id);
    });
  const send = async (owner: string) => {
    const commandId = crypto.randomUUID();
    const outcome = await runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action: 'late.send',
      input: { owner, waybill: 'waybill marker' },
      carrier: testCarrier(acme, testPrincipal('bea')),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId,
    });
    return { outcome, id: deriveEffectId(scope, commandId, 0) };
  };
  return {
    runtime,
    operator,
    taken,
    rowOf,
    send,
    enrol: async (token: string): Promise<string> =>
      String(
        (
          (await operator.invoke('late.enrol', { email: 'ada@example.test', token })) as {
            id: string;
          }
        ).id,
      ),
    erase: async (subjectId: string): Promise<void> => {
      await operator.invoke(
        'core.eraseSubject',
        { subjectId: subjectId as never, reason: 'subjectRequest' } as never,
        { prefer: 'async' },
      );
      await runtime.drainJobs();
      await worker.pass();
      await runtime.drainJobs();
    },
    live: async (keyId: string): Promise<boolean> =>
      (
        await runtime.adapter.unit(runtime.namespace, scope, (unit) =>
          unit.keys.liveValueKeys([keyId]),
        )
      ).length > 0,
    ledgerTombstones: async (): Promise<readonly string[]> =>
      (
        await runtime.control.adapter.unit(
          runtime.control.namespace,
          { level: 'deployment' },
          (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
          { readOnly: true },
        )
      ).flatMap(({ record }) => (record.type === 'keyTombstone' ? [record.keyId] : [])),
  };
}

test('a secret set after the keys were read is tombstoned in the ledger and the sink before it is destroyed', {
  timeout: 60_000,
}, async () => {
  const hook: { key?: string; run?: () => Promise<void> } = {};
  const booted = await boot(async (records) => {
    if (!records.some((record) => record.type === 'keyTombstone' && record.keyId === hook.key)) {
      return;
    }
    const { run } = hook;
    delete hook.run;
    await run?.();
  });
  const id = await booted.enrol('first secret');
  hook.key = valueKeyIdOf((await booted.rowOf('late.member', id))?.token);
  let second = '';
  hook.run = async () => {
    // The sink that takes the tombstone of the first secret replaces it: the unit has not opened yet.
    await booted.operator.invoke('late.reset', { id: id as never, token: 'second secret' });
    second = valueKeyIdOf((await booted.rowOf('late.member', id))?.token);
  };

  await booted.erase(id);

  expect(hook.run).toBeUndefined();
  expect(second).not.toBe(hook.key);
  expect(await booted.ledgerTombstones()).toContain(second);
  expect(
    booted.taken.some((record) => record.type === 'keyTombstone' && record.keyId === second),
  ).toBe(true);
  expect(await booted.live(second)).toBe(false);
});

test('an effect that names the subject and has no personal member is settled by the erasure, and cannot be requested after it', {
  timeout: 60_000,
}, async () => {
  const booted = await boot();
  const owner = await booted.enrol('own secret');
  const { outcome, id } = await booted.send(owner);
  expect(outcome.ok).toBe(true);
  const stored = (await booted.rowOf('core.effect', id))?.input as
    | { waybill?: unknown }
    | undefined;
  const waybill = valueKeyIdOf(stored?.waybill);
  expect(await booted.live(waybill)).toBe(true);

  await booted.erase(owner);

  expect(await booted.rowOf('core.effect', id)).toMatchObject({
    status: 'failed',
    error: { code: 'core.key_destroyed' },
  });
  expect(await booted.live(waybill)).toBe(false);
  expect(await booted.ledgerTombstones()).toContain(waybill);
  const again = await booted.send(owner);
  expect(again.outcome).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  expect(await booted.rowOf('core.effect', again.id)).toBeUndefined();
});

test('a row given to a living subject while its erasure runs is left alone with its key', {
  timeout: 60_000,
}, async () => {
  const hook: { key?: string; run?: () => Promise<void> } = {};
  const booted = await boot(async (records) => {
    if (!records.some((record) => record.type === 'keyTombstone' && record.keyId === hook.key)) {
      return;
    }
    const { run } = hook;
    delete hook.run;
    await run?.();
  });
  const ada = await booted.enrol('ada secret');
  const bea = await booted.enrol('bea secret');
  const post = async (owner: string, secret: string): Promise<string> =>
    String(
      (
        (await booted.operator.invoke('late.post', { owner: owner as never, secret })) as {
          id: string;
        }
      ).id,
    );
  const parcel = await post(ada, 'ada parcel');
  const beas = await post(bea, 'bea parcel');
  hook.key = valueKeyIdOf((await booted.rowOf('late.parcel', parcel))?.secret);
  const live = [valueKeyIdOf((await booted.rowOf('late.parcel', beas))?.secret)];
  live.push(valueKeyIdOf((await booted.rowOf('late.member', bea))?.token));
  let given: unknown;
  hook.run = async () => {
    // The sink that takes the tombstone of the parcel's key: the erasure has not reached the row's unit.
    given = await booted.operator.attempt('late.give', {
      id: parcel as never,
      owner: bea as never,
    });
  };

  await booted.erase(ada);

  expect(hook.run).toBeUndefined();
  expect(given).toMatchObject({ ok: true });
  expect(await booted.rowOf('late.parcel', parcel)).toMatchObject({ owner: bea });
  for (const keyId of [hook.key ?? '', ...live]) expect(await booted.live(keyId)).toBe(true);
  // The open gap: the tombstone the erasure recorded for the moved row's key stands although the key lives.
  expect(await booted.ledgerTombstones()).toContain(hook.key);
});

test('an effect whose data subject is no erasable id is requested as before, on PGlite', {
  timeout: 60_000,
}, async () => {
  const booted = await boot(undefined, 'pglite');
  const { outcome, id } = await booted.send('not-a-uuid-subject');
  expect(outcome.ok).toBe(true);
  expect(await booted.rowOf('core.effect', id)).toMatchObject({ status: 'requested' });
});
