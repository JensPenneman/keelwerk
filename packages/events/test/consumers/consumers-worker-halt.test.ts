import { describe, expect, test } from 'vitest';
import { consumers } from '../../src/consumers/consumers.ts';
import type { ConsumerKitKind } from './support/consumer-kit.ts';
import { soon, startConsumerKit } from './support/consumer-kit.ts';
import { poisonedStream } from './support/poisoned-notes.ts';

describe.each(['memory', 'pglite'] as const satisfies readonly ConsumerKitKind[])(
  'the consumers worker halt on %s',
  (kind) => {
    test('a stop lets the batch in flight finish and runs no further batch of a scope that holds several', async () => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const calls: number[] = [];
      let armed = false;
      const worker = consumers({
        batchSize: 1,
        consumers: [
          {
            id: 'test.worker-halt',
            selector: {},
            start: 'beginning',
            consume: async (events) => {
              if (!armed) return;
              calls.push(events.length);
              entered.resolve();
              await release.promise;
            },
          },
        ],
      });
      const kit = await startConsumerKit(kind, { eventWorkers: [worker] });
      try {
        await worker.settled();
        armed = true;
        // One unit of four events: a scope that holds four batches of one.
        await kit.appendNotes('acme', poisonedStream, 0, 4);
        await entered.promise;
        const stopping = worker.stop(soon());
        // The consume resolves slowly, after the stop was called.
        release.resolve();
        await stopping;
        expect(calls).toEqual([1]);
        expect(await kit.checkpoint('test.worker-halt', 'acme')).toBe(
          (await kit.eventsOf('acme'))[0]?.position,
        );
      } finally {
        await kit.stop();
      }
    }, 60_000);
  },
);
