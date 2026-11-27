import { readFileSync } from 'node:fs';
import type { ErasureRecord, StorageRow, StoredEvent, Unit } from '@keelwerk/core';
import { eraseStream, verifyChain } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';

type Runtime = TestRuntime<typeof erasureDumpApp>;

let current: Runtime | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

/** Ada and Bea, a thread each, a reply of each on the other's thread and a personal tag on Ada's thread. */
async function seeded() {
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(erasureDumpApp, {
    operators: true,
    workers: true,
    eventWorkers: [
      consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }),
      worker,
    ],
  });
  current = runtime;
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const idOf = (answer: unknown, key: string): string =>
    String((answer as Record<string, unknown>)[key]);
  const ada = idOf(
    await operator.invoke('probe.enrol', {
      name: 'Ada',
      email: 'erase.stream.ada@example.test',
      notes: 'ada note',
    }),
    'personId',
  );
  const bea = idOf(
    await operator.invoke('probe.enrol', { name: 'Bea', email: 'erase.stream.bea@example.test' }),
    'personId',
  );
  const adaThread = idOf(
    await operator.invoke('probe.open', {
      ownerId: ada as never,
      title: 'a',
      topic: 'ada topic',
    }),
    'threadId',
  );
  const beaThread = idOf(
    await operator.invoke('probe.open', { ownerId: bea as never, title: 'b' }),
    'threadId',
  );
  await operator.invoke('probe.answer', {
    threadId: adaThread as never,
    replierId: bea as never,
    reply: 'bea reply',
  });
  await operator.invoke('probe.answer', {
    threadId: beaThread as never,
    replierId: ada as never,
    reply: 'ada reply',
  });
  await operator.invoke('probe.jot', { threadId: adaThread as never, tag: 'ada tag' });
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  const inTenant = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
    runtime.sealed.unit(runtime.namespace, scope, fn);
  const erase = async (subject: string): Promise<void> => {
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: subject as never, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    await worker.pass();
  };
  return { runtime, ada, bea, adaThread, beaThread, inTenant, erase };
}

const row = (runtime: Runtime, ref: string, unit: Unit, id: string, includeErased = false) => {
  const entry = runtime.app.registry.entities.get(ref);
  if (entry === undefined) throw new Error(`no entity ${ref}`);
  return unit.rows
    .find(entry.descriptor, {
      where: { op: 'eq', field: 'id', value: id },
      includeArchived: true,
      ...(includeErased ? { includeErased } : {}),
    })
    .then((page): StorageRow | undefined => page.rows[0]);
};

describe('eraseStream on one subject (14.7.5 steps 3 and 4)', () => {
  test("the owned row becomes a tombstone, another subject's value is cleared on a living row, a second call is skipped, the stream records of the owned row are purged", {
    timeout: 60_000,
  }, async () => {
    const { runtime, ada, adaThread, beaThread, inTenant, erase } = await seeded();
    expect(
      await inTenant((unit) => unit.streams.read('probe.notes', adaThread, null, 10)),
    ).toHaveLength(1);
    await erase(ada);

    await inTenant(async (unit) => {
      // The owned rows: invisible to a read, even one that includes archived rows, and a tombstone for the kernel.
      expect(await row(runtime, 'probe.person', unit, ada)).toBeUndefined();
      expect(await row(runtime, 'probe.thread', unit, adaThread)).toBeUndefined();
      const tombstone = await row(runtime, 'probe.person', unit, ada, true);
      expect(tombstone?.kwErasedAt).toBeDefined();
      expect(tombstone?.archivedAt).toBeDefined();
      // Another subject's field on a living row is cleared; the row stays.
      const living = await row(runtime, 'probe.thread', unit, beaThread);
      expect(living?.title).toBe('b');
      expect(living?.reply).toBeUndefined();
      expect(living?.kwErasedAt).toBeUndefined();
      // The records of the owned thread are purged.
      expect(await unit.streams.read('probe.notes', adaThread, null, 10)).toEqual([]);
    });

    // A second call finds nothing to do, and still says which rows the subject owns.
    const record = await runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      async (unit) => (await unit.ledger?.since(0n, 10))?.find((e) => e.record.type === 'erasure'),
      { readOnly: true },
    );
    const erasureRecord = record?.record as ErasureRecord;
    const again = (stream: { type: string; id: string }, record: ErasureRecord = erasureRecord) =>
      inTenant((unit) =>
        eraseStream(unit, {
          registry: runtime.app.registry,
          stream,
          record,
          writer: undefined as never,
          now: Temporal.Now.instant(),
          nominated: true,
        }),
      );
    expect(await again({ type: 'probe.person', id: ada })).toEqual({
      outcome: 'replayed',
      owned: true,
      valueKeys: [],
    });
    expect(await again({ type: 'probe.thread', id: beaThread })).toEqual({
      outcome: 'replayed',
      owned: false,
      valueKeys: [],
    });
    // The same subject asked for in its other spelling (32 hex digits) is the same erasure: replayed, and owned from the first event.
    const compact = { ...erasureRecord, subjectId: ada.replaceAll('-', '') };
    expect(compact.subjectId).not.toBe(ada);
    expect(await again({ type: 'probe.person', id: ada }, compact)).toEqual({
      outcome: 'replayed',
      owned: true,
      valueKeys: [],
    });
  });
});

/** Compares `value` with the committed file `golden/<name>.json`. */
function golden(name: string, value: unknown): void {
  const path = new URL(`./golden/${name}.json`, import.meta.url);
  expect(value).toEqual(JSON.parse(readFileSync(path, 'utf8')));
}

describe('the stored `erased` event (S-168, final)', () => {
  test('its data, its chain and the row it folds to', { timeout: 60_000 }, async () => {
    const { runtime, ada, adaThread, beaThread, inTenant, erase } = await seeded();
    await erase(ada);
    const subject = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value).replaceAll(ada, '<subject>'));
    const streamOf = (type: string, id: string) =>
      inTenant(async (unit) => unit.events.readStream({ type, id }));
    const [person, owned, living] = await Promise.all([
      streamOf('probe.person', ada),
      streamOf('probe.thread', adaThread),
      streamOf('probe.thread', beaThread),
    ]);
    const erasedOf = (events: readonly StoredEvent[]): StoredEvent => {
      const found = events.find((event) => event.type.endsWith('.erased'));
      if (found === undefined) throw new Error('no erased event');
      return found;
    };
    golden(
      'erased-event-data',
      subject({
        person: erasedOf(person).data,
        ownedThread: erasedOf(owned).data,
        livingThread: erasedOf(living).data,
      }),
    );
    // The event is hashed into the chain of its stream like any other, and the chain verifies.
    for (const events of [person, owned, living]) {
      expect(verifyChain(events)).toMatchObject({ ok: true });
      expect(erasedOf(events).hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Folding it back gives the row the write stored: a tombstone at the event's time and version.
    const event = erasedOf(person);
    const tombstone = await inTenant((unit) => row(runtime, 'probe.person', unit, ada, true));
    expect(tombstone?.version).toBe(event.version);
    expect((tombstone?.kwErasedAt as Temporal.Instant | undefined)?.epochMilliseconds).toBe(
      event.recordedAt.epochMilliseconds,
    );
    expect((tombstone?.archivedAt as Temporal.Instant | undefined)?.epochMilliseconds).toBe(
      event.recordedAt.epochMilliseconds,
    );
  });
});
