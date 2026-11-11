import type { ConsumerSpec, StoredEvent } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import { createLocalClient, startTestRuntime, testPrincipal } from '@keelwerk/testing';
import { libraryApp } from '@keelwerk/testing/fixtures';
import { describe, expect, test } from 'vitest';
import { consumers } from '../../src/consumers/consumers.ts';
import { reactionDispatcher } from '../../src/dispatcher/reaction-dispatcher.ts';
import type { ConsumerKitKind } from './support/consumer-kit.ts';

const spec = (id: string, over: Partial<ConsumerSpec> = {}): ConsumerSpec => ({
  id,
  selector: {},
  start: 'beginning',
  consume: async () => undefined,
  ...over,
});

function refusal(work: () => unknown): { kind: string; code: string } | undefined {
  try {
    work();
  } catch (error) {
    if (isKeelwerkError(error)) return { kind: error.kind, code: error.code };
    throw error;
  }
  return undefined;
}

describe('the consumers worker', () => {
  test('the worker is events.consumers for the work role and runs what it was given', () => {
    const plain = consumers({ consumers: [spec('test.one')] });
    expect(plain).toMatchObject({
      id: 'events.consumers',
      roles: ['work'],
      kind: 'eventWorker',
      provides: [],
      runs: [],
    });
    expect(consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }).runs).toEqual(
      ['asyncReactions'],
    );
  });

  test('a duplicate consumer id is refused', async () => {
    const invalid = { kind: 'validation', code: 'core.validation' };
    expect(refusal(() => consumers({ consumers: [spec('test.one'), spec('test.one')] }))).toEqual(
      invalid,
    );
    expect(refusal(() => consumers({ consumers: [], leaseMs: 2 }))).toEqual(invalid);
    expect(refusal(() => consumers({ consumers: [], batchSize: 0 }))).toEqual(invalid);
    expect(refusal(() => consumers({ consumers: [], batchSize: 1001 }))).toEqual(invalid);
    expect(refusal(() => consumers({ consumers: [spec('test.one', { maxAttempts: 0 })] }))).toEqual(
      invalid,
    );
    // A builder is called at start, which then rejects.
    const worker = consumers({ consumers: [spec('test.same'), () => spec('test.same')] });
    const runtime = await startTestRuntime(libraryApp, { eventWorkers: [worker] });
    try {
      await expect(worker.settled()).rejects.toMatchObject(invalid);
    } finally {
      await runtime.stop();
    }
  });

  describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
    'on %s',
    (kind) => {
      test('a test consumer counts the events of two tenants', async () => {
        const seen: StoredEvent[] = [];
        const worker = consumers({
          consumers: [
            spec('test.count', {
              consume: async (events) => {
                seen.push(...events);
              },
            }),
          ],
        });
        const runtime = await startTestRuntime(libraryApp, {
          tenants: ['acme', 'globex'],
          adapter: kind,
          eventWorkers: [worker],
        });
        try {
          const ada = createLocalClient(runtime, { principal: testPrincipal('ada') });
          for (const [index, tenant] of (['acme', 'globex', 'acme'] as const).entries()) {
            await ada
              .as({ tenant })
              .invoke('library.addBook', { title: `Book ${index}`, isbn: `isbn-${index}` });
          }
          await worker.settled();
          for (const tenant of ['acme', 'globex'] as const) {
            const id = runtime.tenants[tenant].id;
            const scope = { level: 'tenant', backendId: runtime.backendId, tenantId: id } as const;
            const { stored, checkpoint } = await runtime.sealed.unit(
              runtime.namespace,
              scope,
              async (unit) => ({
                stored: (await unit.events.readAll(null, { limit: 100 })).events,
                checkpoint: await unit.consumers.checkpoint('test.count', id),
              }),
            );
            expect(stored.length).toBeGreaterThan(0);
            expect(checkpoint).toBe(stored.at(-1)?.position);
            const delivered = seen.filter(
              (event) => event.scope.level === 'tenant' && event.scope.tenantId === id,
            );
            expect(delivered.map((event) => event.eventId)).toEqual(stored.map((e) => e.eventId));
          }
          expect(await worker.settled()).toBe(0);
          await expect(
            worker.unpark('test.count', runtime.namespace.id, runtime.tenants.acme.id, {
              type: 'library.book',
              id: '00000000-0000-7000-8000-000000000a01',
            }),
          ).resolves.toBeNull();
          await expect(
            worker.unpark('test.other', runtime.namespace.id, runtime.tenants.acme.id, {
              type: 'library.book',
              id: '00000000-0000-7000-8000-000000000a01',
            }),
          ).rejects.toMatchObject({ kind: 'not_found', code: 'core.not_found' });
        } finally {
          await runtime.stop();
        }
      }, 60_000);
    },
  );
});
