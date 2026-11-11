import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { StoredEvent } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { dumpDatabase, findPlaintext } from '@keelwerk/testing';
import { startPostgres } from '@keelwerk/testing/postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { consumers } from '../../src/consumers/consumers.ts';
import type { ConsumersWorker } from '../../src/consumers/consumers-worker.ts';
import type { ConsumerKit, CountingConsumer } from './support/consumer-kit.ts';
import { countingConsumer, startConsumerKit } from './support/consumer-kit.ts';
import { isPoison, poisonedNotes } from './support/poisoned-notes.ts';

describe('consumers on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let kit: ConsumerKit;
  let worker: ConsumersWorker;
  let counted: CountingConsumer;
  let polled: CountingConsumer;

  beforeAll(async () => {
    postgres = await startPostgres();
    // The runtime's own consumers are built beside the kit's, on its adapter, with notify off.
    counted = countingConsumer('test.count');
    polled = countingConsumer('test.poll');
    worker = consumers({ consumers: [counted.spec, polled.spec] });
    kit = await startConsumerKit('memory', {
      external: (clock) => ({
        factory: postgresAdapter({
          ownerUrl: postgres.adminUrl,
          clock,
          accelerations: { notify: false },
        }),
        url: postgres.appUrl,
      }),
      eventWorkers: [worker],
    });
  }, 180_000);

  afterAll(async () => {
    await kit?.stop();
    await postgres?.stop();
  });

  const idsOf = (events: readonly StoredEvent[]): string[] => events.map((e) => e.eventId);

  test('a test consumer counts the events of two tenants on PostgreSQL', async () => {
    await kit.addBooks('acme', 3);
    await kit.addBooks('globex', 2);
    await worker.settled();
    for (const tenant of ['acme', 'globex'] as const) {
      const stored = await kit.eventsOf(tenant);
      const delivered = counted.delivered.filter(
        (event) => event.scope.level === 'tenant' && event.scope.tenantId === kit.scopeIdOf(tenant),
      );
      expect(idsOf(delivered)).toEqual(idsOf(stored));
      expect(await kit.checkpoint('test.count', tenant)).toBe(stored.at(-1)?.position);
    }
  });

  test('with notify off the runner consumes through the polling feed', async () => {
    await kit.addBooks('globex', 2);
    const head = (await kit.eventsOf('globex')).at(-1)?.position;
    // The one real-time wait of these tests, bounded to a few seconds: with notify off the poll feed
    // wakes the runner on a wall-clock interval that no fixed clock moves. The wait is on the position.
    await vi.waitFor(
      async () => {
        expect(await kit.checkpoint('test.poll', 'globex')).toBe(head);
      },
      { timeout: 10_000, interval: 50 },
    );
    expect(await kit.checkpoint('test.poll', 'globex')).toBe(head);
  });

  test("a poison event of tenant A parks its stream after five attempts while tenant B's checkpoint keeps moving", async () => {
    await poisonedNotes(kit);
    await kit.addBooks('globex', 2);
    const consumer = kit.counting('test.pg-poison');
    consumer.poison = isPoison;
    const runner = kit.runnerOf(consumer.spec, 'one');
    expect((await runner.pass()).holding).toBe(true);
    const alone = consumer.calls.filter(
      (call) => call.events.length === 1 && isPoison(call.events[0] as StoredEvent),
    );
    expect(alone).toHaveLength(5);
    const parked = await kit.parked('test.pg-poison', 'acme');
    expect(parked).toHaveLength(1);
    expect(await kit.checkpoint('test.pg-poison', 'acme')).toBe(
      (await kit.eventsOf('acme')).at(-1)?.position,
    );
    expect(await kit.checkpoint('test.pg-poison', 'globex')).toBe(
      (await kit.eventsOf('globex')).at(-1)?.position,
    );
  });

  test('a dump holds no plaintext of the error a parked stream kept, and holds its code', async () => {
    // A stream of its own: the tests before this one wrote to the shared poisoned streams.
    const stream = { type: 'library.book', id: crypto.randomUUID() };
    await kit.appendNotes('acme', stream, 0, 3);
    const consumer = kit.counting('test.pg-dump');
    consumer.poison = (event) => event.stream.id === stream.id && event.version === 2;
    consumer.failWith = () => errors.not_found('No account for ada@example.org');
    const runner = kit.runnerOf(consumer.spec, 'one');
    expect((await runner.pass()).holding).toBe(true);
    expect(await kit.parked('test.pg-dump', 'acme')).toHaveLength(1);
    const owner = new pg.Client({ connectionString: postgres.adminUrl });
    await owner.connect();
    try {
      const dump = await dumpDatabase(async (sql) => (await owner.query(sql)).rows);
      // The controls: the finder sees the consumer's name in the tables the store wrote.
      expect(findPlaintext(dump, ['test.pg-dump', 'core.not_found'])).toEqual([
        'test.pg-dump',
        'core.not_found',
      ]);
      expect(findPlaintext(dump, ['ada@example.org', 'No account'])).toEqual([]);
    } finally {
      await owner.end();
    }
  });

  test('killing the lease holder moves the lease to another runner within its ttl', async () => {
    const consumer = kit.counting('test.pg-takeover');
    const leaseMs = 30_000;
    const first = kit.runnerOf(consumer.spec, 'one', { leaseMs });
    const second = kit.runnerOf(consumer.spec, 'two', { leaseMs });
    expect((await first.pass()).holding).toBe(true);
    expect((await second.pass()).holding).toBe(false);
    kit.clock.advance(leaseMs / 3);
    expect((await second.pass()).holding).toBe(false);
    kit.clock.advance(leaseMs);
    const pass = await second.pass();
    expect(pass.holding).toBe(true);
    expect(pass.batches).toBeGreaterThan(0);
    const stored = await kit.eventsOf('globex');
    expect(await kit.checkpoint('test.pg-takeover', 'globex')).toBe(stored.at(-1)?.position);
  });
});
