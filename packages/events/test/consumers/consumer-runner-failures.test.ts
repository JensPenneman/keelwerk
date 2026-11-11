import { errors, KeelwerkError } from '@keelwerk/core';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ConsumerKit, ConsumerKitKind } from './support/consumer-kit.ts';
import { startConsumerKit } from './support/consumer-kit.ts';
import {
  byVersion,
  cleanStream,
  isPoison,
  poisonedNotes,
  poisonedStream,
} from './support/poisoned-notes.ts';

describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
  'consumer runner failures on %s',
  (kind) => {
    let kit: ConsumerKit;
    beforeEach(async () => {
      kit = await startConsumerKit(kind);
    }, 60_000);
    afterEach(async () => {
      await kit.stop();
    });

    test("later events of a parked stream are skipped and recorded, and the scope's other streams continue", async () => {
      const events = await poisonedNotes(kit);
      const consumer = kit.counting('test.skip');
      consumer.poison = isPoison;
      await kit.runnerOf(consumer.spec, 'one').pass();
      const delivered = consumer.delivered.map((event) => `${event.stream.id}/${event.version}`);
      expect(delivered).toEqual([
        `${poisonedStream.id}/1`,
        `${cleanStream.id}/1`,
        `${cleanStream.id}/2`,
      ]);
      const poison = events.get(`${poisonedStream.id}/2`);
      const parked = await kit.parked('test.skip', 'acme');
      expect(parked).toHaveLength(1);
      // One parking for the failed event and one for each later event of the stream.
      expect(parked[0]).toMatchObject({ from: poison?.position, attempts: 3 });
      expect(await kit.checkpoint('test.skip', 'acme')).toBe([...events.values()].at(-1)?.position);
    });

    test('unpark replays the parked stream from from_position and removes the park', async () => {
      await poisonedNotes(kit);
      const consumer = kit.counting('test.unpark');
      consumer.poison = isPoison;
      const runner = kit.runnerOf(consumer.spec, 'one');
      await runner.pass();
      const [row] = await kit.parked('test.unpark', 'acme');
      expect(row).toBeDefined();
      consumer.poison = () => false;
      consumer.delivered.length = 0;
      const from = await runner.unpark(kit.scopeIdOf('acme'), poisonedStream);
      expect(from).toBe(row?.from);
      expect(consumer.delivered.map((event) => `${event.stream.id}/${event.version}`)).toEqual([
        `${poisonedStream.id}/2`,
        `${poisonedStream.id}/3`,
        `${poisonedStream.id}/4`,
      ]);
      expect(await kit.parked('test.unpark', 'acme')).toEqual([]);
      expect(await runner.unpark(kit.scopeIdOf('acme'), poisonedStream)).toBeNull();
    });

    test('a replay that fails again keeps the stream parked and counts the parking', async () => {
      await poisonedNotes(kit);
      const consumer = kit.counting('test.replay');
      consumer.poison = isPoison;
      const runner = kit.runnerOf(consumer.spec, 'one');
      await runner.pass();
      const [before] = await kit.parked('test.replay', 'acme');
      await expect(runner.unpark(kit.scopeIdOf('acme'), poisonedStream)).rejects.toThrow(
        'the consumer failed',
      );
      const [after] = await kit.parked('test.replay', 'acme');
      expect(after?.from).toBe(before?.from);
      expect(after?.attempts).toBe((before?.attempts ?? 0) + 1);
      expect(after?.parkedAt.epochMilliseconds).toBe(before?.parkedAt.epochMilliseconds);
    });

    test('a failed batch that read parked events retries one event at a time and keeps their records', async () => {
      await poisonedNotes(kit);
      const consumer = kit.counting('test.partial');
      const other = { type: 'library.book', id: crypto.randomUUID() };
      consumer.poison = (event) => isPoison(event) || event.stream.id === other.id;
      const runner = kit.runnerOf(consumer.spec, 'one');
      await runner.pass();
      const [before] = await kit.parked('test.partial', 'acme');
      // One more event of the parked stream (skipped) and one poisoned event of another stream
      // arrive together: the batch reads both and can deliver only the second.
      await kit.appendNotes('acme', poisonedStream, 4, 1);
      await kit.appendNotes('acme', other, 0, 1);
      await runner.pass({ sweep: true });
      const [after] = await kit.parked('test.partial', 'acme');
      expect(after?.attempts).toBe((before?.attempts ?? 0) + 1);
      expect(await kit.parked('test.partial', 'acme')).toHaveLength(2);
    });

    test('a rate-limited batch holds its scope on the runtime clock without counting an attempt', async () => {
      await kit.addBooks('acme', 2);
      const consumer = kit.counting('test.limited');
      consumer.poison = () => true;
      consumer.failWith = () => errors.rate_limited('The queue is full.', { retryAfter: 5 });
      const runner = kit.runnerOf(consumer.spec, 'one');
      expect((await runner.pass()).batches).toBe(0);
      const first = consumer.calls.length;
      expect(first).toBeGreaterThan(0);
      expect(runner.dueAt().epochMilliseconds).toBe(kit.clock.now().epochMilliseconds + 5000);
      await runner.pass();
      expect(consumer.calls).toHaveLength(first);
      kit.clock.advance(5001);
      consumer.poison = () => false;
      expect((await runner.pass()).batches).toBeGreaterThan(0);
      expect(await kit.parked('test.limited', 'acme')).toEqual([]);
      const stored = await kit.eventsOf('acme');
      expect(await kit.checkpoint('test.limited', 'acme')).toBe(stored.at(-1)?.position);
    });

    test("a parked stream's stored error holds the kind and code, never the message", async () => {
      await poisonedNotes(kit);
      const consumer = kit.counting('test.error');
      consumer.poison = isPoison;
      consumer.failWith = () =>
        new KeelwerkError({
          kind: 'conflict',
          code: 'library.isbn_taken',
          message: 'ada@example.org already owns this isbn',
        });
      await kit.runnerOf(consumer.spec, 'one').pass();
      const [row] = await kit.parked('test.error', 'acme');
      expect(row?.lastError).toMatchObject({
        kind: 'conflict',
        code: 'library.isbn_taken',
        retryable: false,
      });
      expect(JSON.stringify(row?.lastError)).not.toContain('ada@example.org');
      const events = await byVersion(kit, 'acme');
      expect(events.size).toBe(6);
    });
  },
);
