import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ConsumerKit, ConsumerKitKind } from './support/consumer-kit.ts';
import { startConsumerKit } from './support/consumer-kit.ts';

describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
  'consumer runner on %s',
  (kind) => {
    let kit: ConsumerKit;
    beforeEach(async () => {
      kit = await startConsumerKit(kind);
    }, 60_000);
    afterEach(async () => {
      await kit.stop();
    });

    test("a consumer with start beginning delivers each scope's history in position order", async () => {
      await kit.addBooks('acme', 3);
      await kit.addBooks('globex', 2);
      const consumer = kit.counting('test.history');
      const runner = kit.runnerOf(consumer.spec, 'one');
      const pass = await runner.pass();
      expect(pass.holding).toBe(true);
      expect(pass.batches).toBeGreaterThan(0);
      for (const tenant of ['acme', 'globex'] as const) {
        const stored = await kit.eventsOf(tenant);
        const delivered = consumer.delivered.filter(
          (event) =>
            event.scope.level === 'tenant' && event.scope.tenantId === kit.scopeIdOf(tenant),
        );
        expect(delivered.map((event) => event.eventId)).toEqual(
          stored.map((event) => event.eventId),
        );
        expect(await kit.checkpoint('test.history', tenant)).toBe(stored.at(-1)?.position);
      }
    });

    test('a consumer added later with start now sees no history, then sees what follows', async () => {
      await kit.addBooks('acme', 2);
      await kit.addBooks('globex', 1);
      const consumer = kit.counting('test.now', { start: 'now' });
      const runner = kit.runnerOf(consumer.spec, 'one');
      await runner.pass();
      expect(consumer.calls).toEqual([]);
      const heads = await Promise.all([kit.eventsOf('acme'), kit.eventsOf('globex')]);
      expect(await kit.checkpoint('test.now', 'acme')).toBe(heads[0].at(-1)?.position);
      expect(await kit.checkpoint('test.now', 'globex')).toBe(heads[1].at(-1)?.position);
      const before = (await kit.eventsOf('acme')).length;
      await kit.addBooks('acme', 2);
      const pass = await runner.pass({ sweep: true });
      expect(pass.batches).toBeGreaterThan(0);
      const after = await kit.eventsOf('acme');
      expect(consumer.delivered.map((event) => event.eventId)).toEqual(
        after.slice(before).map((event) => event.eventId),
      );
    });

    test('a scope created after a start now consumer began is delivered from its first event', async () => {
      // One consumer begins when nothing has an event yet, the other when acme has history.
      const bare = kit.counting('test.new-scope-bare', { start: 'now' });
      const bareRunner = kit.runnerOf(bare.spec, 'one');
      await bareRunner.pass();
      await kit.addBooks('acme', 2);
      const late = kit.counting('test.new-scope-late', { start: 'now' });
      const lateRunner = kit.runnerOf(late.spec, 'two');
      await lateRunner.pass();
      expect(late.calls).toEqual([]);
      await kit.addBooks('globex', 2);
      await bareRunner.pass({ sweep: true });
      await lateRunner.pass({ sweep: true });
      const ids = (events: readonly { readonly eventId: string }[]): string[] =>
        events.map((event) => event.eventId);
      const acme = ids(await kit.eventsOf('acme'));
      const globex = ids(await kit.eventsOf('globex'));
      expect(ids(late.delivered)).toEqual(globex);
      expect(ids(bare.delivered).toSorted()).toEqual([...acme, ...globex].toSorted());
    });

    test('two scopes never share a unit', async () => {
      await kit.addBooks('acme', 3);
      await kit.addBooks('globex', 3);
      const consumer = kit.counting('test.units');
      await kit.runnerOf(consumer.spec, 'one', { batchSize: 2 }).pass();
      const seen = new Set<string>();
      for (const call of consumer.calls) {
        if (call.scope.level !== 'tenant') throw new Error('a consumer unit is not a tenant unit');
        seen.add(call.scope.tenantId);
        for (const event of call.events) {
          expect(event.scope).toEqual(call.scope);
        }
      }
      expect(seen.size).toBe(2);
    });

    test('a busy scope yields after one batch, so a quiet scope is served next', async () => {
      await kit.addBooks('acme', 6);
      await kit.addBooks('globex', 1);
      const consumer = kit.counting('test.rounds');
      await kit.runnerOf(consumer.spec, 'one', { batchSize: 2 }).pass();
      const quiet = consumer.calls.findIndex(
        (call) => call.scope.level === 'tenant' && call.scope.tenantId === kit.scopeIdOf('globex'),
      );
      expect(quiet).toBeGreaterThanOrEqual(0);
      expect(quiet).toBeLessThanOrEqual(1);
      const busy = consumer.calls.filter(
        (call) => call.scope.level === 'tenant' && call.scope.tenantId === kit.scopeIdOf('acme'),
      );
      expect(busy.length).toBeGreaterThan(1);
      for (const call of busy) expect(call.events.length).toBeLessThanOrEqual(2);
    });

    test("a poison event of tenant A parks its stream after five attempts while tenant B's checkpoint keeps moving", async () => {
      await kit.addBooks('acme', 4);
      await kit.addBooks('globex', 3);
      const stored = await kit.eventsOf('acme');
      const poison = stored[2];
      if (poison === undefined) throw new Error('the library wrote fewer events than expected');
      const consumer = kit.counting('test.poison');
      consumer.poison = (event) => event.eventId === poison.eventId;
      const runner = kit.runnerOf(consumer.spec, 'one');
      const pass = await runner.pass();
      expect(pass.holding).toBe(true);
      const alone = consumer.calls.filter(
        (call) => call.events.length === 1 && call.events[0]?.eventId === poison.eventId,
      );
      expect(alone).toHaveLength(5);
      expect(await kit.checkpoint('test.poison', 'acme')).toBe(stored.at(-1)?.position);
      const globex = await kit.eventsOf('globex');
      expect(await kit.checkpoint('test.poison', 'globex')).toBe(globex.at(-1)?.position);
      const parked = await kit.parked('test.poison', 'acme');
      expect(parked).toHaveLength(1);
      expect(parked[0]).toMatchObject({
        stream: poison.stream,
        from: poison.position,
        attempts: 1,
        lastError: { kind: 'internal', code: 'core.internal' },
      });
      expect(await kit.parked('test.poison', 'globex')).toEqual([]);
      expect(consumer.delivered.some((event) => event.eventId === poison.eventId)).toBe(false);
      expect(kit.log.some((line) => line.level === 'error')).toBe(true);
    });
  },
);
