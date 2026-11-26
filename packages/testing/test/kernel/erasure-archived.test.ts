import type { ErasureRecord } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { boot, erasures, resetOwnErasure, warned } from './support/own-erasure-kit.ts';

afterEach(resetOwnErasure);

const unknownTenant = 'an erasure record names a tenant nobody knows; it is tried again';

type Booted = Awaited<ReturnType<typeof boot>>;

/** `core.tenant.archive` or `core.tenant.restore` of the first tenant, through the control action that also drops the directory's cache. */
async function moveTenant(
  runtime: Booted['runtime'],
  action: 'archive' | 'restore',
): Promise<void> {
  const moved = await runtime.invoker.invoke({
    action: `core.tenant.${action}`,
    input: { id: runtime.tenants.acme?.id ?? '' },
    carrier: { transport: 'test', local: { inProcess: true } },
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
  expect(moved.ok).toBe(true);
}

async function accept(booted: Booted): Promise<string> {
  const itemId = String((await booted.operator.invoke('oes.make', { note: 'mine' })).itemId);
  const asked = { subjectId: itemId, reason: 'operator' };
  expect((await booted.operator.attempt('core.eraseSubject', asked)).ok).toBe(true);
  return itemId;
}

async function finished(booted: Booted, itemId: string): Promise<void> {
  const { ledger, rows, keyLive } = booted;
  const [record] = erasures(await ledger());
  expect(record).toBeDefined();
  expect(await keyLive(itemId)).toBe(false);
  const types = (await ledger()).map((entry) => (entry.record as { type: string }).type);
  expect(types).toContain('erasureCompleted');
  const receipts = await rows('core.commandReceipt', false);
  expect(receipts.find((row) => row.commandId === record?.commandId)?.status).toBe('completed');
}

describe.each(['memory', 'pglite'] as const)(
  'an erasure of an archived tenant on %s',
  (adapter) => {
    test('A1: a tenant archived after the record of its erasure: the erasure completes, and so does its receipt', async () => {
      const booted = await boot(adapter);
      const itemId = await accept(booted);
      await booted.runtime.drainJobs();
      await moveTenant(booted.runtime, 'archive');
      await booted.worker.pass();
      await finished(booted, itemId);
    });

    test('A1b: a tenant archived before the job of its accepted erasure starts: the job records it, the worker finishes it, the receipt completes', async () => {
      const booted = await boot(adapter);
      const itemId = await accept(booted);
      await moveTenant(booted.runtime, 'archive');
      await booted.runtime.drainJobs();
      await booted.worker.pass();
      await moveTenant(booted.runtime, 'restore');
      await finished(booted, itemId);
    });

    // The SQL adapters open a key through the serving reading of the scope directory. The erasure
    // reaches an archived tenant through the archived reading, which no adapter, key store or
    // request path is given: the key of an archived tenant stays closed to them.
    test.runIf(adapter === 'pglite')(
      'A3: while a tenant is archived, no unit of the serving adapter opens its subject keys',
      async () => {
        const booted = await boot(adapter);
        const itemId = String((await booted.operator.invoke('oes.make', { note: 'mine' })).itemId);
        expect(await booted.keyLive(itemId)).toBe(true);
        await moveTenant(booted.runtime, 'archive');
        await expect(booted.keyLive(itemId)).rejects.toMatchObject({ code: 'core.not_found' });
        await moveTenant(booted.runtime, 'restore');
        expect(await booted.keyLive(itemId)).toBe(true);
      },
    );

    test('A2: a record of a tenant nobody knows is tried again on every pass and warned about once; a second record, once more', async () => {
      const { runtime, worker } = await boot(adapter);
      const append = (record: ErasureRecord) =>
        runtime.control.adapter.unit(
          runtime.control.namespace,
          { level: 'deployment' },
          (unit) => unit.ledger?.append(record) ?? Promise.resolve(0n),
        );
      const unknown = (): ErasureRecord => ({
        type: 'erasure',
        tenantId: crypto.randomUUID(),
        subjectId: crypto.randomUUID(),
        recordedAt: runtime.clock.now().toString(),
        requester: { kind: 'operator', id: null, via: 'core.operator' },
        reason: 'operator',
        commandId: crypto.randomUUID(),
      });
      const warnings = () => warned.filter((message) => message === unknownTenant).length;
      await append(unknown());
      for (let poll = 0; poll < 3; poll += 1) {
        await worker.pass();
        await runtime.advanceTo(runtime.clock.now().add({ hours: 2 }));
      }
      expect(warnings()).toBe(1);
      await append(unknown());
      for (let poll = 0; poll < 3; poll += 1) {
        await worker.pass();
        await runtime.advanceTo(runtime.clock.now().add({ hours: 2 }));
      }
      expect(warnings()).toBe(2);
    });
  },
);
