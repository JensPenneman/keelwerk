import { errors } from '@keelwerk/core';
import { createLocalClient, startTestRuntime, testPrincipal } from '@keelwerk/testing';
import { libraryApp } from '@keelwerk/testing/fixtures';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { consumers } from '../../src/consumers/consumers.ts';
import type { ConsumerKit, ConsumerKitKind } from './support/consumer-kit.ts';
import { soon, startConsumerKit } from './support/consumer-kit.ts';
import { interceptUnits } from './support/intercept-units.ts';
import { poisonedStream } from './support/poisoned-notes.ts';
import { slowRollback } from './support/slow-rollback.ts';

/** A consume that never settles. */
const forever = (): Promise<never> => new Promise<never>(() => undefined);

describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
  'consumer runner stop and deadlines on %s',
  (kind) => {
    let kit: ConsumerKit;
    beforeEach(async () => {
      kit = await startConsumerKit(kind);
    }, 60_000);
    afterEach(async () => {
      await kit.stop();
    });

    const taken = (consumer: string): Promise<boolean> =>
      kit.runtime.sealed.unit(
        kit.runtime.namespace,
        { level: 'namespace', reason: 'test' },
        (unit) => unit.consumers.acquireLease(consumer, 'other', 1000),
        { readOnly: false },
      );

    test('stop returns by its deadline while a consume never settles, and leaves the lease to expire', async () => {
      await kit.addBooks('acme', 1);
      const entered = Promise.withResolvers<void>();
      const consumer = kit.counting('test.stop-hung');
      const runner = kit.runnerOf(
        {
          ...consumer.spec,
          consume: async () => {
            entered.resolve();
            await forever();
          },
        },
        'one',
        // The batch deadline is a third of the lease: the unit rolls back a second later.
        { leaseMs: 3000 },
      );
      const pass = runner.pass();
      await entered.promise;
      runner.halt();
      const began = Date.now();
      await runner.stop(Temporal.Now.instant().add({ milliseconds: 200 }));
      expect(Date.now() - began).toBeLessThan(900);
      expect(kit.log.some((line) => line.message.includes('left to expire'))).toBe(true);
      // The batch deadline ends the pass; no further turn starts, and the lease was never handed over.
      await pass;
      expect(await taken('test.stop-hung')).toBe(false);
    });

    test('a stop with a deadline longer than the batch deadline leaves the lease while an abandoned consume still runs', async () => {
      await kit.addBooks('acme', 1);
      const entered = Promise.withResolvers<void>();
      const consumer = kit.counting('test.stop-abandoned');
      const runner = kit.runnerOf(
        {
          ...consumer.spec,
          consume: async () => {
            entered.resolve();
            await forever();
          },
        },
        'one',
        // The batch deadline is a third of the lease: the runner's queue goes on after 300 ms.
        { leaseMs: 900 },
      );
      const pass = runner.pass();
      await entered.promise;
      runner.halt();
      // The stop waits longer than the batch deadline: the queue is idle by then, the consume is not.
      await runner.stop(Temporal.Now.instant().add({ milliseconds: 5000 }));
      await pass;
      expect(
        kit.log.filter((line) => line.message.includes('work that outlived its deadline')),
      ).toHaveLength(1);
      expect(await taken('test.stop-abandoned')).toBe(false);
    });

    test('a read that answers after the deadline does not lead to a consume call', async () => {
      await kit.addBooks('acme', 1);
      const answered = Promise.withResolvers<void>();
      const late = interceptUnits(
        kit,
        () => undefined,
        (unit) =>
          unit.scope.level === 'tenant' && !unit.readOnly
            ? {
                ...unit,
                events: {
                  ...unit.events,
                  // The read is made at once and its answer is held back past the deadline.
                  readAll: async (...args) => {
                    const page = await unit.events.readAll(...args);
                    await new Promise((resolve) => setTimeout(resolve, 700));
                    answered.resolve();
                    return page;
                  },
                },
              }
            : unit,
      );
      const consumer = kit.counting('test.read-late');
      // The batch deadline is a third of the lease: 300 ms.
      const runner = kit.runnerOf(consumer.spec, 'one', { leaseMs: 900, source: late });
      expect(await runner.pass()).toEqual({ holding: true, batches: 0 });
      await answered.promise;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(consumer.calls).toEqual([]);
      expect(await kit.checkpoint('test.read-late', 'acme')).toBeNull();
    });

    test('a consume that outlasts the batch deadline fails inside its unit, counts one attempt and leaves other scopes served', async () => {
      await kit.addBooks('acme', 1);
      await kit.addBooks('globex', 1);
      const consumer = kit.counting('test.deadline', { maxAttempts: 1 });
      const acme = kit.scopeIdOf('acme');
      const runner = kit.runnerOf(
        {
          ...consumer.spec,
          consume: async (events, unit) => {
            if (
              events.some(
                (event) => event.scope.level === 'tenant' && event.scope.tenantId === acme,
              )
            ) {
              await forever();
            }
            await consumer.spec.consume(events, unit);
          },
        },
        'one',
        // The batch deadline is a third of the lease: it also covers the lock and the reads.
        { leaseMs: 900 },
      );
      expect((await runner.pass()).holding).toBe(true);
      const parked = await kit.parked('test.deadline', 'acme');
      expect(parked.length).toBeGreaterThan(0);
      expect(parked[0]?.lastError).toMatchObject({ kind: 'internal', code: 'core.internal' });
      expect(consumer.delivered.length).toBeGreaterThan(0);
      expect(
        consumer.delivered.every(
          (event) => event.scope.level === 'tenant' && event.scope.tenantId !== acme,
        ),
      ).toBe(true);
      expect(await kit.checkpoint('test.deadline', 'globex')).toBe(
        (await kit.eventsOf('globex')).at(-1)?.position,
      );
    });

    test('a consume that resolves while its unit rolls back after the deadline still counts as that consume failing', async () => {
      await kit.addBooks('acme', 1);
      const consumer = kit.counting('test.deadline-resolves', { maxAttempts: 1 });
      const runner = kit.runnerOf(
        {
          ...consumer.spec,
          // The batch deadline (a third of the lease) passes while this runs; it resolves
          // before the slow rollback has answered.
          consume: () => new Promise<void>((resolve) => setTimeout(resolve, 450)),
        },
        'one',
        { leaseMs: 900, source: slowRollback(kit, 500) },
      );
      expect((await runner.pass()).holding).toBe(true);
      expect(await kit.parked('test.deadline-resolves', 'acme')).toHaveLength(1);
      expect(
        kit.log.some((line) => line.message === 'a consumer batch failed outside the consumer'),
      ).toBe(false);
    });

    test('a consume that rejects while its unit rolls back after the deadline keeps the deadline as the failure', async () => {
      await kit.addBooks('acme', 1);
      const consumer = kit.counting('test.deadline-rejects', { maxAttempts: 1 });
      const runner = kit.runnerOf(
        {
          ...consumer.spec,
          // The batch deadline passes while this runs; it answers rate_limited before the slow
          // rollback has answered, which must not replace the deadline, nor count as no attempt.
          consume: () =>
            new Promise<void>((_, reject) =>
              setTimeout(
                () => reject(errors.rate_limited('The queue is full.', { retryAfter: 5 })),
                450,
              ),
            ),
        },
        'one',
        { leaseMs: 900, source: slowRollback(kit, 500) },
      );
      expect((await runner.pass()).holding).toBe(true);
      const parked = await kit.parked('test.deadline-rejects', 'acme');
      expect(parked).toHaveLength(1);
      expect(parked[0]?.lastError).toMatchObject({ kind: 'internal', code: 'core.internal' });
    });

    test('a read that never settles fails its batch by the deadline: the whole unit is raced, not only consume', async () => {
      await kit.addBooks('acme', 1);
      const hung = interceptUnits(
        kit,
        () => undefined,
        (unit) =>
          unit.scope.level === 'tenant' && !unit.readOnly
            ? { ...unit, events: { ...unit.events, readAll: forever } }
            : unit,
      );
      const consumer = kit.counting('test.read-hung');
      const runner = kit.runnerOf(consumer.spec, 'one', { leaseMs: 900, source: hung });
      expect(await runner.pass()).toEqual({ holding: true, batches: 0 });
      expect(consumer.calls).toEqual([]);
      expect(await kit.checkpoint('test.read-hung', 'acme')).toBeNull();
      expect(
        kit.log.some((line) => line.message === 'a consumer batch failed outside the consumer'),
      ).toBe(true);
    });

    test('only the holder of the lease unparks: a standby and a stopped runner refuse', async () => {
      const consumer = kit.counting('test.unpark-guard');
      const holder = kit.runnerOf(consumer.spec, 'one');
      const standby = kit.runnerOf(consumer.spec, 'two');
      expect((await holder.pass()).holding).toBe(true);
      expect((await standby.pass()).holding).toBe(false);
      const refusal = { kind: 'unavailable', code: 'core.unavailable' };
      await expect(standby.unpark(kit.scopeIdOf('acme'), poisonedStream)).rejects.toMatchObject(
        refusal,
      );
      await expect(holder.unpark(kit.scopeIdOf('acme'), poisonedStream)).resolves.toBeNull();
      await holder.stop(soon());
      await expect(holder.unpark(kit.scopeIdOf('acme'), poisonedStream)).rejects.toMatchObject(
        refusal,
      );
    });
  },
);

describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
  'the consumers worker stop on %s',
  (kind) => {
    test('stop returns by its deadline while a consume never settles', async () => {
      const entered = Promise.withResolvers<void>();
      const worker = consumers({
        consumers: [
          {
            id: 'test.worker-hung',
            selector: {},
            start: 'beginning',
            consume: async () => {
              entered.resolve();
              await forever();
            },
          },
        ],
        // The batch deadline is a third of the lease, so the hung unit rolls back after a second.
        leaseMs: 3000,
      });
      const runtime = await startTestRuntime(libraryApp, {
        tenants: ['acme'],
        adapter: kind,
        eventWorkers: [worker],
      });
      try {
        const ada = createLocalClient(runtime, { principal: testPrincipal('ada') });
        await ada.as({ tenant: 'acme' }).invoke('library.addBook', { title: 'Book', isbn: 'i-1' });
        await entered.promise;
        const began = Date.now();
        await worker.stop(Temporal.Now.instant().add({ milliseconds: 200 }));
        expect(Date.now() - began).toBeLessThan(900);
      } finally {
        await runtime.stop();
      }
    }, 60_000);
  },
);
