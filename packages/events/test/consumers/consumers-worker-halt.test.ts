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

    test('a process that left service delivers nothing of an event that becomes available afterwards', async () => {
      const calls: number[] = [];
      let armed = false;
      const worker = consumers({
        consumers: [
          {
            id: 'test.left-service',
            selector: {},
            start: 'beginning',
            consume: async (events) => {
              if (armed) calls.push(events.length);
            },
          },
        ],
      });
      // The signal of a service aborts when the gate closes, even with its evidence pending.
      const leaving = new AbortController();
      const gated = {
        ...worker,
        start: (context: Parameters<typeof worker.start>[0]) =>
          worker.start({ ...context, signal: AbortSignal.any([context.signal, leaving.signal]) }),
      };
      const kit = await startConsumerKit(kind, { eventWorkers: [gated] });
      try {
        await worker.settled();
        armed = true;
        await kit.appendNotes('acme', poisonedStream, 0, 1);
        await worker.settled();
        expect(calls).toEqual([1]);
        leaving.abort();
        await kit.appendNotes('acme', poisonedStream, 1, 2);
        // The change feed wakes the runners and the wall timer runs them: neither delivers.
        await worker.settled();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(calls).toEqual([1]);
      } finally {
        await kit.stop();
      }
    }, 60_000);
  },
);
