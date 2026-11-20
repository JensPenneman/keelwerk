import type { FlagProvider, Scope, StorageRow } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import {
  erasureHold,
  legalHold,
  legalHoldAsyncProvider,
  legalHoldProvider,
  ownErasureApp,
} from './support/own-erasure-module.ts';
import { setFlag } from './support/targeting-kit.ts';

type Runtime = TestRuntime<typeof ownErasureApp>;
type Caller = {
  invoke: (action: string, input: unknown) => Promise<Record<string, unknown>>;
  attempt: (
    action: string,
    input: unknown,
  ) => Promise<{ ok: boolean; error?: { kind: string; code: string; message: string } }>;
};

let current: Runtime | undefined;
afterEach(async () => {
  erasureHold.on = false;
  legalHold.on = false;
  await current?.stop();
  current = undefined;
});

async function boot(adapter: 'memory' | 'pglite', provider: FlagProvider = legalHoldProvider) {
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(ownErasureApp, {
    adapter,
    operators: true,
    workers: true,
    eventWorkers: [worker],
    flagProviders: [provider],
  });
  current = runtime;
  const operator = createLocalClient(runtime, {
    principal: testOperator(),
    tenant: 'acme',
  }) as unknown as Caller;
  const scope: Scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme?.id ?? '',
  };
  /** The job of the request, the steps of the worker and the jobs those leave. */
  const settle = async (): Promise<void> => {
    await runtime.drainJobs();
    await worker.pass();
    await runtime.drainJobs();
  };
  const rows = (ref: string, opened: boolean): Promise<readonly StorageRow[]> => {
    const descriptor = runtime.app.registry.entities.get(ref)?.descriptor;
    if (descriptor === undefined) throw new Error(`no entity ${ref}`);
    const unitOf = opened
      ? runtime.sealed.unit.bind(runtime.sealed)
      : runtime.adapter.unit.bind(runtime.adapter);
    return unitOf(
      runtime.namespace,
      scope,
      async (unit) =>
        (await unit.rows.find(descriptor, { includeArchived: true, includeErased: !opened })).rows,
    );
  };
  const keyLive = (subject: string): Promise<boolean> =>
    runtime.adapter.unit(
      runtime.namespace,
      scope,
      async (unit) => (await unit.keys.dataKey(subject, { create: false })) !== undefined,
      { readOnly: true },
    );
  const ledger = () =>
    runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
      { readOnly: true },
    );
  return { runtime, operator, settle, rows, keyLive, ledger };
}

const providers = [
  ['synchronous', legalHoldProvider],
  ['asynchronous', legalHoldAsyncProvider],
] as const;

const person = () => crypto.randomUUID();
const erasures = (entries: readonly { readonly record: unknown }[]) =>
  entries
    .map((entry) => entry.record as Record<string, unknown>)
    .filter((r) => r.type === 'erasure');

describe.each(['memory', 'pglite'] as const)(
  'a module erases the id of its own row on %s',
  (adapter) => {
    const timeout = 60_000;

    test('C1: the commit holds the request, the worker erases the row and the ledger names the module', {
      timeout,
    }, async () => {
      const { operator, settle, rows, ledger } = await boot(adapter);
      const made = await operator.invoke('oes.make', { note: 'a personal note' });
      const itemId = String(made.itemId);
      await operator.invoke('oes.end', { itemId });
      // The request job found its accepted receipt: the ledger records the erasure before any step ran.
      await current?.drainJobs();
      const before = erasures(await ledger());
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({
        subjectId: itemId,
        reason: 'retention',
        requester: { kind: 'service', id: 'oes.system' },
      });
      expect((await rows('oes.item', false))[0]?.kwErasedAt ?? null).toBeNull();
      await settle();
      const [item] = await rows('oes.item', false);
      expect(item?.kwErasedAt).toBeDefined();
      expect(await rows('oes.item', true)).toEqual([]);
    });

    test('C2: a row moved to another subject in the same decision is left alone by the walk', {
      timeout,
    }, async () => {
      const { operator, settle, rows, ledger } = await boot(adapter);
      const subject = person();
      const keeper = String((await operator.invoke('oes.make', { subject, note: 'kept' })).itemId);
      const moved = String((await operator.invoke('oes.make', { note: 'moves' })).itemId);
      await operator.invoke('oes.end', { itemId: moved, moveTo: subject });
      await settle();
      expect(erasures(await ledger()).map((record) => record.subjectId)).toEqual([moved]);
      const live = await rows('oes.item', true);
      expect(live.map((row) => String(row.id)).sort()).toEqual([keeper, moved].sort());
      expect(live.map((row) => row.note).sort()).toEqual(['kept', 'moves']);
    });

    test('C3: another module cannot ask for the erasure of a row that is not its own, and its writes roll back', {
      timeout,
    }, async () => {
      const { operator, rows, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      const refused = await operator.attempt('intruder.ask', { type: 'oes.item', id: itemId });
      expect(refused.ok).toBe(false);
      expect(refused.error?.code).toBe('core.request_not_allowed');
      expect(await rows('intruder.trace', false)).toEqual([]);
      expect(await keyLive(itemId)).toBe(true);
    });

    test('C4: an id that equals a subject another row owns ends the row, and the key stays', {
      timeout,
    }, async () => {
      const { operator, rows, keyLive, settle, ledger } = await boot(adapter);
      const victim = person();
      await operator.invoke('oes.hold', { ownerId: victim, label: 'owned by the victim' });
      await operator.invoke('oes.make', { id: victim, note: 'a copy of the id' });
      expect(await keyLive(victim)).toBe(true);
      const ended = await operator.attempt('oes.end', { itemId: victim });
      expect(ended.ok).toBe(true);
      expect((await rows('oes.item', true))[0]?.state).toBe('ended');
      // The job asks again, and every time another row holds the subject: nothing is erased.
      await settle();
      await current?.advanceTo(current.clock.now().add({ hours: 3 }));
      await settle();
      expect(await keyLive(victim)).toBe(true);
      expect(erasures(await ledger())).toEqual([]);
    });

    test('C5: an id that another stream refers to ends the row, and the key stays', {
      timeout,
    }, async () => {
      const { operator, rows, keyLive, settle, ledger } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      await operator.invoke('oes.speak', {
        ownerId: person(),
        aboutId: itemId,
        text: 'about it',
      });
      const ended = await operator.attempt('oes.end', { itemId });
      expect(ended.ok).toBe(true);
      expect((await rows('oes.item', true))[0]?.state).toBe('ended');
      await settle();
      await current?.advanceTo(current.clock.now().add({ hours: 3 }));
      await settle();
      expect(await keyLive(itemId)).toBe(true);
      expect(erasures(await ledger())).toEqual([]);
    });

    test('C6: a hold on the erasure does not stop the end; the erasure starts when the hold lifts', {
      timeout,
    }, async () => {
      const { operator, rows, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      erasureHold.on = true;
      const ended = await operator.attempt('oes.end', { itemId });
      expect(ended.ok).toBe(true);
      expect((await rows('oes.item', true))[0]?.state).toBe('ended');
      await settle();
      expect(erasures(await ledger())).toEqual([]);
      expect(await keyLive(itemId)).toBe(true);
      // Still held when the job asks again.
      await current?.advanceTo(current.clock.now().add({ hours: 2 }));
      await settle();
      expect(erasures(await ledger())).toEqual([]);
      erasureHold.on = false;
      await current?.advanceTo(current.clock.now().add({ hours: 2 }));
      await settle();
      expect(erasures(await ledger())).toHaveLength(1);
      expect(await keyLive(itemId)).toBe(false);
      expect(await rows('oes.item', true)).toEqual([]);
    });

    test.each(providers)(
      'C6b: a hold that reads a flag a provider turns on keeps the key until the provider turns it off (%s provider)',
      { timeout },
      async (_label, provider) => {
        const { operator, ledger, settle, keyLive } = await boot(adapter, provider);
        const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
        legalHold.on = true;
        expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
        await settle();
        // The job asks again twice, and the flag holds each time: the key is not shredded.
        for (let retry = 0; retry < 2; retry += 1) {
          await current?.advanceTo(current.clock.now().add({ hours: 2 }));
          await settle();
          expect(erasures(await ledger())).toEqual([]);
          expect(await keyLive(itemId)).toBe(true);
        }
        legalHold.on = false;
        await current?.advanceTo(current.clock.now().add({ hours: 2 }));
        await settle();
        expect(erasures(await ledger())).toHaveLength(1);
        expect(await keyLive(itemId)).toBe(false);
      },
    );

    test.each(providers)(
      "C6c: the operator's own erasure call is refused while the flag holds and succeeds after (%s provider)",
      { timeout },
      async (_label, provider) => {
        const { operator, ledger, settle, keyLive } = await boot(adapter, provider);
        const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
        legalHold.on = true;
        const refused = await operator.attempt('core.eraseSubject', {
          subjectId: itemId,
          reason: 'subjectRequest',
        });
        expect(refused.ok).toBe(false);
        expect(refused.error?.kind).toBe('forbidden');
        await settle();
        expect(erasures(await ledger())).toEqual([]);
        expect(await keyLive(itemId)).toBe(true);
        legalHold.on = false;
        const allowed = await operator.attempt('core.eraseSubject', {
          subjectId: itemId,
          reason: 'subjectRequest',
        });
        expect(allowed.ok).toBe(true);
        await settle();
        expect(await keyLive(itemId)).toBe(false);
      },
    );

    // The memory store answers the targeting read at once. The cache does not wait for a load that
    // is still in flight (`fresh`), and on PGlite one is, so there the rows may serve STALE (WP-100).
    test.runIf(adapter === 'memory')(
      'C6d: a hold turned on by a targeting row keeps the key when the job asks again long after the row was loaded',
      {
        timeout,
      },
      async () => {
        const { runtime, operator, ledger, settle, keyLive } = await boot(adapter);
        const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
        const targeting = (value: boolean) => ({
          key: 'oes.legalHold',
          targeting: { enabled: true, rules: [], fallthrough: { value } },
          reason: 'legal hold',
        });
        expect((await setFlag(runtime, targeting(true))).ok).toBe(true);
        expect((await operator.attempt('oes.end', { itemId })).ok).toBe(true);
        await settle();
        expect(await keyLive(itemId)).toBe(true);
        // No call of an invocation refreshes the rows meanwhile: only the job's own admission can.
        for (let retry = 0; retry < 2; retry += 1) {
          await current?.advanceTo(current.clock.now().add({ hours: 2 }));
          await settle();
          expect(erasures(await ledger())).toEqual([]);
          expect(await keyLive(itemId)).toBe(true);
        }
        expect((await setFlag(runtime, targeting(false))).ok).toBe(true);
        await current?.advanceTo(current.clock.now().add({ hours: 2 }));
        await settle();
        expect(erasures(await ledger())).toHaveLength(1);
        expect(await keyLive(itemId)).toBe(false);
      },
    );

    test('C7: a job that first starts more than a day after its request still erases', {
      timeout,
    }, async () => {
      const { operator, ledger, settle, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      // The workers are held back by the hold until the clock has gone past the default receipt window.
      erasureHold.on = true;
      await operator.invoke('oes.end', { itemId });
      await settle();
      erasureHold.on = false;
      await current?.advanceTo(current.clock.now().add({ hours: 30 }));
      await settle();
      expect(erasures(await ledger())).toHaveLength(1);
      expect(await keyLive(itemId)).toBe(false);
    });
  },
);
