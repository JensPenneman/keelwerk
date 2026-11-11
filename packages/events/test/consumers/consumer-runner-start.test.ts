import type { StorageScope } from '@keelwerk/core';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ConsumerKit, ConsumerKitKind } from './support/consumer-kit.ts';
import { soon, startConsumerKit } from './support/consumer-kit.ts';
import { interceptUnits } from './support/intercept-units.ts';

const leaseMs = 30_000;

const reasonOf = (scope: StorageScope): string | undefined =>
  scope.level === 'namespace' ? scope.reason : undefined;

describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
  'consumer runner start now on %s',
  (kind) => {
    let kit: ConsumerKit;
    beforeEach(async () => {
      kit = await startConsumerKit(kind);
    }, 60_000);
    afterEach(async () => {
      await kit.stop();
    });

    const ids = (events: readonly { readonly eventId: string }[]): string[] =>
      events.map((event) => event.eventId);

    test('a start now consumer on a namespace without events delivers what is appended after it first ran, also after a restart', async () => {
      const consumer = kit.counting('test.start-empty', { start: 'now' });
      const first = kit.runnerOf(consumer.spec, 'one');
      expect((await first.pass()).holding).toBe(true);
      await first.stop(soon());
      await kit.addBooks('acme', 2);
      const second = kit.runnerOf(consumer.spec, 'two');
      expect((await second.pass()).holding).toBe(true);
      expect(ids(consumer.delivered)).toEqual(ids(await kit.eventsOf('acme')));
      expect(consumer.delivered.length).toBeGreaterThan(0);
    });

    test('a start whose unit fails delivers nothing and the next pass starts every scope at its head', async () => {
      await kit.addBooks('acme', 2);
      await kit.addBooks('globex', 1);
      let rejected = false;
      const source = interceptUnits(kit, (scope) => {
        if (reasonOf(scope) === 'consumer start' && !rejected) {
          rejected = true;
          throw new Error('the store is unreachable');
        }
      });
      const consumer = kit.counting('test.start-failed', { start: 'now' });
      const runner = kit.runnerOf(consumer.spec, 'one', { source });
      expect(await runner.pass()).toEqual({ holding: true, batches: 0 });
      expect(rejected).toBe(true);
      expect(kit.log.some((line) => line.message === 'a consumer could not start')).toBe(true);
      expect(consumer.calls).toEqual([]);
      expect(await kit.checkpoint('test.start-failed', 'acme')).toBeNull();
      expect((await runner.pass()).holding).toBe(true);
      expect(consumer.calls).toEqual([]);
      for (const tenant of ['acme', 'globex'] as const) {
        expect(await kit.checkpoint('test.start-failed', tenant)).toBe(
          (await kit.eventsOf(tenant)).at(-1)?.position,
        );
      }
      const before = (await kit.eventsOf('acme')).length;
      await kit.addBooks('acme', 1);
      await runner.pass({ sweep: true });
      expect(ids(consumer.delivered)).toEqual(ids((await kit.eventsOf('acme')).slice(before)));
    });

    test('a takeover right after the start delivers no history of any scope', async () => {
      await kit.addBooks('acme', 2);
      await kit.addBooks('globex', 2);
      const consumer = kit.counting('test.start-takeover', { start: 'now' });
      let died = false;
      // The first runner commits its start, then its process dies and its lease lapses.
      const source = interceptUnits(kit, (scope) => {
        if (reasonOf(scope) === 'consumer sweep' && !died) {
          died = true;
          kit.clock.advance(leaseMs + 1);
          throw new Error('the process died');
        }
      });
      const first = kit.runnerOf(consumer.spec, 'one', { leaseMs, source });
      await expect(first.pass()).rejects.toThrow('the process died');
      const second = kit.runnerOf(consumer.spec, 'two', { leaseMs });
      const before = (await kit.eventsOf('acme')).length;
      await kit.addBooks('acme', 1);
      expect((await second.pass()).holding).toBe(true);
      expect(ids(consumer.delivered)).toEqual(ids((await kit.eventsOf('acme')).slice(before)));
      expect(consumer.delivered.length).toBeGreaterThan(0);
      expect(await kit.checkpoint('test.start-takeover', 'globex')).toBe(
        (await kit.eventsOf('globex')).at(-1)?.position,
      );
    });

    test('an append between the start and the sweep is delivered', async () => {
      await kit.addBooks('acme', 1);
      await kit.addBooks('globex', 1);
      const before = (await kit.eventsOf('globex')).length;
      let appended = false;
      const source = interceptUnits(kit, async (scope) => {
        if (reasonOf(scope) === 'consumer sweep' && !appended) {
          appended = true;
          await kit.addBooks('globex', 1);
        }
      });
      const consumer = kit.counting('test.start-append', { start: 'now' });
      await kit.runnerOf(consumer.spec, 'one', { source }).pass();
      expect(appended).toBe(true);
      expect(ids(consumer.delivered)).toEqual(ids((await kit.eventsOf('globex')).slice(before)));
      expect(consumer.delivered.length).toBeGreaterThan(0);
    });

    test('a sweep that fails after an acquisition is run again by the next pass, and no history is delivered', async () => {
      await kit.addBooks('acme', 2);
      let failed = false;
      const source = interceptUnits(kit, (scope) => {
        if (reasonOf(scope) === 'consumer sweep' && !failed) {
          failed = true;
          throw new Error('the store is unreachable');
        }
      });
      const consumer = kit.counting('test.start-sweep', { start: 'now' });
      const runner = kit.runnerOf(consumer.spec, 'one', { source });
      await expect(runner.pass()).rejects.toThrow('the store is unreachable');
      const before = (await kit.eventsOf('acme')).length;
      await kit.addBooks('acme', 1);
      // A plain pass: the decision that follows an acquisition is not left to a pass that asks for it.
      expect((await runner.pass()).batches).toBeGreaterThan(0);
      expect(ids(consumer.delivered)).toEqual(ids((await kit.eventsOf('acme')).slice(before)));
      expect(consumer.delivered.length).toBeGreaterThan(0);
    });

    test('a halt during the start ends the pass after the start: no sweep, no replay, no batch', async () => {
      await kit.addBooks('acme', 2);
      await kit.addBooks('globex', 2);
      const reasons: (string | undefined)[] = [];
      const consumer = kit.counting('test.start-halt', { start: 'now' });
      const source = interceptUnits(kit, (scope) => {
        reasons.push(reasonOf(scope));
        if (reasonOf(scope) === 'consumer start') runner.halt();
      });
      const runner = kit.runnerOf(consumer.spec, 'one', { source });
      expect(await runner.pass()).toEqual({ holding: true, batches: 0 });
      expect(reasons).not.toContain('consumer sweep');
      expect(consumer.calls).toEqual([]);
      for (const tenant of ['acme', 'globex'] as const) {
        expect(await kit.checkpoint('test.start-halt', tenant)).toBe(
          (await kit.eventsOf(tenant)).at(-1)?.position,
        );
      }
    });
  },
);
