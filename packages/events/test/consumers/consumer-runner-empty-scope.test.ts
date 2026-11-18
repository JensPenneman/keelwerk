import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ConsumerKit, ConsumerKitKind } from './support/consumer-kit.ts';
import { startConsumerKit } from './support/consumer-kit.ts';

describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
  'consumer runner on a scope with no event on %s',
  (kind) => {
    let kit: ConsumerKit;
    beforeEach(async () => {
      kit = await startConsumerKit(kind);
    }, 60_000);
    afterEach(async () => {
      await kit.stop();
    });

    test('a wake of a scope that holds no event runs no further batch once the runner has looked', async () => {
      // A writing unit that appends nothing still wakes its scope (the feed wakes after every
      // writing unit), and a batch is such a unit: without a mark for a scope read to its
      // (absent) head, each batch would wake the scope for the next and `settled` never ends.
      const consumer = kit.counting('test.empty-scope');
      const runner = kit.runnerOf(consumer.spec, 'one');
      await kit.addBooks('acme', 1);
      await runner.pass();
      const globex = kit.scopeIdOf('globex');
      runner.wake([globex]);
      await runner.pass();
      runner.wake([globex]);
      expect(await runner.pass({ sweep: true })).toEqual({ holding: true, batches: 0 });
      expect(consumer.calls.every((call) => call.events.length > 0)).toBe(true);
      // The first event of that scope is still delivered.
      await kit.addBooks('globex', 1);
      expect((await runner.pass({ sweep: true })).batches).toBeGreaterThan(0);
      expect(consumer.delivered.length).toBeGreaterThan(1);
    }, 60_000);
  },
);
