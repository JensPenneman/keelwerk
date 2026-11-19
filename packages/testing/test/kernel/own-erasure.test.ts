import type { Scope, StorageRow } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { erasureHold, ownErasureApp } from './support/own-erasure-module.ts';

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
  await current?.stop();
  current = undefined;
});

async function boot(adapter: 'memory' | 'pglite') {
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(ownErasureApp, {
    adapter,
    operators: true,
    workers: true,
    eventWorkers: [worker],
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

    test('C4: an id that equals a subject another row owns is refused and the key stays', {
      timeout,
    }, async () => {
      const { operator, rows, keyLive } = await boot(adapter);
      const victim = person();
      await operator.invoke('oes.hold', { ownerId: victim, label: 'owned by the victim' });
      await operator.invoke('oes.make', { id: victim, note: 'a copy of the id' });
      expect(await keyLive(victim)).toBe(true);
      const refused = await operator.attempt('oes.end', { itemId: victim });
      expect(refused.error?.code).toBe('core.request_not_allowed');
      expect(refused.error?.message).not.toContain(victim);
      expect(await keyLive(victim)).toBe(true);
      expect((await rows('oes.item', true))[0]?.state).toBe('open');
    });

    test('C5: an id that another stream refers to is refused', { timeout }, async () => {
      const { operator, rows, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      await operator.invoke('oes.speak', {
        ownerId: person(),
        aboutId: itemId,
        text: 'about it',
      });
      const refused = await operator.attempt('oes.end', { itemId });
      expect(refused.error?.code).toBe('core.request_not_allowed');
      expect(await keyLive(itemId)).toBe(true);
      expect((await rows('oes.item', true))[0]?.state).toBe('open');
    });

    test('C6: a deny rule on the erasure refuses the end and rolls it back', {
      timeout,
    }, async () => {
      const { operator, rows, ledger, settle } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      erasureHold.on = true;
      const refused = await operator.attempt('oes.end', { itemId });
      expect(refused.error?.kind).toBe('forbidden');
      expect((await rows('oes.item', true))[0]?.state).toBe('open');
      erasureHold.on = false;
      await settle();
      expect(erasures(await ledger())).toEqual([]);
    });
  },
);
