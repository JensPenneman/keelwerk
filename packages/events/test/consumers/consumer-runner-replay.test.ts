import type { ScopeTarget, StoredEvent } from '@keelwerk/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { unparkStream } from '../../src/consumers/unpark-stream.ts';
import type { ConsumerKit, ConsumerKitKind } from './support/consumer-kit.ts';
import { startConsumerKit } from './support/consumer-kit.ts';
import { interceptUnits } from './support/intercept-units.ts';
import { poisonedStream } from './support/poisoned-notes.ts';
import { slowRollback } from './support/slow-rollback.ts';

const eventsInStream = 6;
const chunk = 2;

describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
  'the chunked replay of a parked stream on %s',
  (kind) => {
    let kit: ConsumerKit;
    beforeEach(async () => {
      kit = await startConsumerKit(kind);
    }, 60_000);
    afterEach(async () => {
      await kit.stop();
    });

    /** The stream's first event is poisoned, so it is parked there with every later event recorded. */
    const parkLongStream = async (id: string) => {
      await kit.appendNotes('acme', poisonedStream, 0, eventsInStream);
      const consumer = kit.counting(id);
      consumer.poison = (event) => event.stream.id === poisonedStream.id && event.version === 1;
      await kit.runnerOf(consumer.spec, 'one').pass();
      expect(await kit.parked(id, 'acme')).toHaveLength(1);
      consumer.poison = () => false;
      consumer.delivered.length = 0;
      consumer.calls.length = 0;
      return consumer;
    };
    const targetOf = (units: { count: number }): ScopeTarget => {
      const source = interceptUnits(kit, (scope) => {
        if (scope.level === 'tenant') units.count += 1;
      });
      return {
        scope: kit.scopeOf('acme'),
        namespace: kit.runtime.namespace,
        handle: source.handle,
      };
    };
    const versions = (events: readonly StoredEvent[]): number[] =>
      events.map((event) => event.version);

    test('a long parked stream replays in several units, each moving the start of the parked row on', async () => {
      const consumer = await parkLongStream('test.replay-chunks');
      const units = { count: 0 };
      const starts: bigint[] = [];
      const answered = await unparkStream({
        spec: consumer.spec,
        target: targetOf(units),
        scopeId: kit.scopeIdOf('acme'),
        stream: poisonedStream,
        batchSize: chunk,
        deadlineMs: 5000,
        log: kit.logger,
        proceed: async () => {
          const [row] = await kit.parked('test.replay-chunks', 'acme');
          if (row !== undefined) starts.push(row.from);
          return true;
        },
      });
      expect(answered).not.toBeNull();
      expect(consumer.calls.map((call) => versions(call.events))).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
      // Three chunks that delivered, one more that found the stream's end: a unit each, besides the checkpoint reads.
      expect(units.count).toBeGreaterThanOrEqual(4);
      expect(starts).toHaveLength(3);
      expect(starts[0]).toBeGreaterThan(answered ?? 0n);
      expect(starts[1]).toBeGreaterThan(starts[0] ?? 0n);
      expect(starts[2]).toBeGreaterThan(starts[1] ?? 0n);
      expect(await kit.parked('test.replay-chunks', 'acme')).toEqual([]);
    });

    test('a chunk that fails after committed chunks parks the stream at the start of the failing chunk, and a later replay delivers the rest once', async () => {
      const consumer = await parkLongStream('test.replay-fail');
      const [parkedBefore] = await kit.parked('test.replay-fail', 'acme');
      const positionOf = async (version: number): Promise<bigint | undefined> =>
        (await kit.eventsOf('acme')).find(
          (event) => event.stream.id === poisonedStream.id && event.version === version,
        )?.position;
      consumer.poison = (event) => event.stream.id === poisonedStream.id && event.version === 4;
      const input = {
        spec: consumer.spec,
        target: targetOf({ count: 0 }),
        scopeId: kit.scopeIdOf('acme'),
        stream: poisonedStream,
        batchSize: chunk,
        deadlineMs: 5000,
        log: kit.logger,
      };
      await expect(unparkStream(input)).rejects.toThrow('the consumer failed');
      expect(consumer.calls.map((call) => versions(call.events))).toEqual([
        [1, 2],
        [3, 4],
      ]);
      expect(consumer.delivered.map((event) => event.version)).toEqual([1, 2]);
      const [row] = await kit.parked('test.replay-fail', 'acme');
      expect(row?.from).toBe(await positionOf(3));
      // The chunk that committed kept the count and the parking time; the failing chunk counts once more.
      expect(row?.attempts).toBe((parkedBefore?.attempts ?? 0) + 1);
      expect(row?.parkedAt.epochMilliseconds).toBe(parkedBefore?.parkedAt.epochMilliseconds);
      consumer.poison = () => false;
      await unparkStream(input);
      expect(consumer.delivered.map((event) => event.version)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(await kit.parked('test.replay-fail', 'acme')).toEqual([]);
    });

    test('a replay chunk whose consume resolves while its unit rolls back after the deadline still re-parks the stream', async () => {
      const consumer = await parkLongStream('test.replay-deadline');
      const [before] = await kit.parked('test.replay-deadline', 'acme');
      const slow = slowRollback(kit, 500);
      await expect(
        unparkStream({
          spec: {
            ...consumer.spec,
            consume: () => new Promise<void>((resolve) => setTimeout(resolve, 250)),
          },
          target: {
            scope: kit.scopeOf('acme'),
            namespace: kit.runtime.namespace,
            handle: slow.handle,
          },
          scopeId: kit.scopeIdOf('acme'),
          stream: poisonedStream,
          batchSize: chunk,
          deadlineMs: 150,
          log: kit.logger,
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining('did not finish') });
      const [row] = await kit.parked('test.replay-deadline', 'acme');
      expect(row?.from).toBe(before?.from);
      expect(row?.attempts).toBe((before?.attempts ?? 0) + 1);
    });

    test('a throw between two chunks resumes without delivering a committed chunk again', async () => {
      const consumer = await parkLongStream('test.replay-resume');
      const input = {
        spec: consumer.spec,
        target: targetOf({ count: 0 }),
        scopeId: kit.scopeIdOf('acme'),
        stream: poisonedStream,
        batchSize: chunk,
        deadlineMs: 5000,
        log: kit.logger,
      };
      await expect(
        unparkStream({
          ...input,
          proceed: async () => {
            throw new Error('the process died');
          },
        }),
      ).rejects.toThrow('the process died');
      expect(consumer.delivered.map((event) => event.version)).toEqual([1, 2]);
      const [row] = await kit.parked('test.replay-resume', 'acme');
      expect(row).toBeDefined();
      await unparkStream(input);
      expect(consumer.delivered.map((event) => event.version)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(await kit.parked('test.replay-resume', 'acme')).toEqual([]);
    });

    test('a crash between two chunks leaves the attempts and the parking time of the row as they were', async () => {
      const id = 'test.replay-crash';
      const consumer = await parkLongStream(id);
      const [before] = await kit.parked(id, 'acme');
      expect(before).toBeDefined();
      // More than one, so a row that was deleted and inserted again (count 1) would differ.
      expect(before?.attempts).toBeGreaterThan(1);
      kit.clock.advance(5000);
      await expect(
        unparkStream({
          spec: consumer.spec,
          target: targetOf({ count: 0 }),
          scopeId: kit.scopeIdOf('acme'),
          stream: poisonedStream,
          batchSize: chunk,
          deadlineMs: 5000,
          log: kit.logger,
          proceed: async () => {
            throw new Error('the process died');
          },
        }),
      ).rejects.toThrow('the process died');
      expect(consumer.delivered.map((event) => event.version)).toEqual([1, 2]);
      const [after] = await kit.parked(id, 'acme');
      expect(after?.from).toBeGreaterThan(before?.from ?? 0n);
      expect(after?.attempts).toBe(before?.attempts);
      expect(after?.parkedAt.epochMilliseconds).toBe(before?.parkedAt.epochMilliseconds);
      expect(after?.lastError).toEqual(before?.lastError);
    });

    test('a replay stops between chunks when the runner may not go on, and the stream stays parked from there', async () => {
      const consumer = await parkLongStream('test.replay-halt');
      await expect(
        unparkStream({
          spec: consumer.spec,
          target: targetOf({ count: 0 }),
          scopeId: kit.scopeIdOf('acme'),
          stream: poisonedStream,
          batchSize: chunk,
          deadlineMs: 5000,
          log: kit.logger,
          proceed: async () => false,
        }),
      ).rejects.toMatchObject({ kind: 'unavailable' });
      expect(consumer.delivered.map((event) => event.version)).toEqual([1, 2]);
      expect(await kit.parked('test.replay-halt', 'acme')).toHaveLength(1);
    });

    test('a consume that resumes after its deadline and writes is refused, and nothing is committed anywhere', async () => {
      await kit.addBooks('acme', 1);
      const acme = kit.scopeIdOf('acme');
      const gate = Promise.withResolvers<void>();
      const outcome = Promise.withResolvers<unknown>();
      const consumer = kit.counting('test.late-write', { maxAttempts: 1 });
      const runner = kit.runnerOf(
        {
          ...consumer.spec,
          consume: async (_events, unit) => {
            await gate.promise;
            try {
              await unit.consumers.advance('test.late-writer', acme, 1n);
              outcome.resolve(undefined);
            } catch (error) {
              outcome.resolve(error);
              throw error;
            }
          },
        },
        'one',
        // The batch deadline is a third of the lease.
        { leaseMs: 900 },
      );
      expect((await runner.pass()).holding).toBe(true);
      gate.resolve();
      expect(await outcome.promise).toMatchObject({ kind: 'internal', code: 'core.internal' });
      await vi.waitFor(() => {
        expect(
          kit.log.filter((line) => line.message.includes('failed after its deadline')),
        ).toHaveLength(1);
      });
      expect(await kit.checkpoint('test.late-writer', 'acme')).toBeNull();
      expect(await kit.checkpoint('test.late-write', 'acme')).toBe(
        (await kit.eventsOf('acme')).at(-1)?.position,
      );
      expect(await kit.parked('test.late-write', 'acme')).toHaveLength(1);
    });
  },
);
