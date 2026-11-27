import { defineApp, field, openStoredEvents } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { feed, skeletonModule } from './support/marked-skeleton.ts';

/**
 * A domain event with a list whose elements are personal seals the list whole (14.7.4). Published
 * 0.2.0 stored such a list in clear; what a read makes of an event stored that way is shown here.
 */
const app = defineApp({
  id: 'mp-app',
  modules: [
    skeletonModule('domainEvent', { names: field.list(field.string().personal()) }),
  ] as never,
});

type Runtime = Awaited<ReturnType<typeof startTestRuntime>>;
let current: Runtime | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

type StoredEvent = {
  type: string;
  data: unknown;
  schemaVersion: number;
  shape: string;
  hlc: unknown;
  recordedAt: unknown;
  actor: unknown;
  commandId: string;
  action: string;
  correlationId: string;
};
interface Unit {
  events: {
    readAll: (a: null, o: object) => Promise<{ events: StoredEvent[] }>;
    append: (batches: object[]) => Promise<unknown>;
  };
}

const worker = erasure({ pollMs: 3_600_000 });
const dispatcher = consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });

async function boot() {
  const runtime = (await startTestRuntime(
    app as never,
    {
      adapter: 'memory',
      operators: true,
      workers: true,
      eventWorkers: [dispatcher, worker],
    } as never,
  )) as Runtime;
  current = runtime;
  const operator = createLocalClient(runtime as never, {
    principal: testOperator(),
    tenant: 'acme',
  }) as never as { invoke: (a: string, i: unknown, o?: object) => Promise<{ id?: string }> };
  return { runtime: runtime as never as Loose, operator };
}
type Loose = {
  sealed: {
    unit: (ns: unknown, s: unknown, f: (u: never) => Promise<unknown>) => Promise<unknown>;
  };
  adapter: {
    unit: (ns: unknown, s: unknown, f: (u: never) => Promise<unknown>) => Promise<unknown>;
  };
  namespace: unknown;
  backendId: string;
  tenants: { acme: { id: string } };
};

describe('an event stored in clear before the list was sealed', () => {
  test('is read as stored, and the erasure of its subject does not reach it', {
    timeout: 60_000,
  }, async () => {
    const { runtime, operator } = await boot();
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    };
    feed.values = { names: ['SEALED-NAME'] };
    const made = await operator.invoke('mp.enrol', {});
    await operator.invoke('mp.holder.note', { id: made.id });
    // Copy the sealed event of the entity and store it again with the list in clear, as 0.2.0 did.
    await runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
      const u = unit as never as Unit;
      const all = (await u.events.readAll(null, { limit: 100, includeTransient: true })).events;
      const noted = all.find((e) => e.type === 'mp.holder.noted');
      if (noted === undefined) throw new Error(`no noted event in ${all.map((e) => e.type)}`);
      expect(JSON.stringify(noted.data)).not.toContain('SEALED-NAME');
      const clone = {
        eventId: crypto.randomUUID(),
        name: 'noted',
        schemaVersion: noted.schemaVersion,
        shape: noted.shape,
        data: { names: ['OLD-CLEAR-NAME'] },
        before: null,
        hlc: noted.hlc,
        recordedAt: noted.recordedAt,
        meta: {
          actor: noted.actor,
          commandId: noted.commandId,
          action: noted.action,
          causationId: null,
          correlationId: noted.correlationId,
          client: null,
          merge: null,
          traceparent: null,
          writer: { build: 'test', revision: 0 },
          flags: [],
          decision: null,
        },
        transient: false,
        prevHash: null,
        hash: null,
      };
      await u.events.append([
        {
          stream: { type: 'mp.holder', id: String(made.id) },
          expectedVersion: 2,
          partition: null,
          events: [clone],
        },
      ]);
    });
    const read = async () =>
      JSON.stringify(
        await runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
          const u = unit as never as Unit;
          const events = (await u.events.readAll(null, { limit: 100, includeTransient: true }))
            .events;
          return (await openStoredEvents(unit as never, events as never)).map((e) => e.data);
        }),
      );
    const before = await read();
    expect(before).toContain('SEALED-NAME');
    expect(before).toContain('OLD-CLEAR-NAME');
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: made.id, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    await dispatcher.settled();
    await worker.pass();
    const after = await read();
    expect(after).not.toContain('SEALED-NAME');
    expect(after).toContain('OLD-CLEAR-NAME');
  });
});
