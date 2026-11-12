import type { LiveFrame } from '@keelwerk/core';
import { defineApp } from '@keelwerk/core';
import { createLocalClient, startTestRuntime, testPrincipal } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { live } from '../../src/live-module.ts';
import { board } from '../hub/support/board-module.ts';
import { collectFrames } from '../support/collect-frames.ts';

vi.setConfig({ testTimeout: 60_000 });

const runtime = await startTestRuntime(defineApp({ id: 'surfacing', modules: [live, board] }), {
  tenants: ['acme'],
});
afterAll(() => runtime.stop());

const writer = createLocalClient(runtime, {
  principal: testPrincipal('w', { claims: { seed: true } }),
});

describe('the local client holds a subscription to the surface of its action', () => {
  test('a masked row arrives without the field and with $masked, as it does over SSE', async () => {
    const viewer = createLocalClient(runtime, {
      principal: testPrincipal('vic', { roles: ['viewer'] }),
    });
    const title = `masked-${crypto.randomUUID()}`;
    await writer.invoke('board.card.create', {
      owner: 'ada',
      title,
      shown: true,
      note: 'for the owner only',
    } as never);
    const stream = collectFrames(
      viewer.subscribe('board.card.watch', { from: 'beginning' } as never),
    );
    try {
      await stream.until((frames) =>
        frames.some((frame) => 'event' in frame && JSON.stringify(frame.event).includes(title)),
      );
      const item = stream.frames.flatMap((frame) => ('event' in frame ? [frame.event] : [])).at(-1);
      expect(item).toMatchObject({ type: 'changed', row: { title, $masked: ['note'] } });
      expect((item as { row: object }).row).not.toHaveProperty('note');
    } finally {
      await stream.stop();
    }
  });

  /** A runtime whose hub yields `head` and an item of a type the surface does not know, and whose `return()` is `onReturn`. */
  const refusingRuntime = (onReturn: () => Promise<void>) =>
    ({
      ...runtime,
      invoker: {
        ...runtime.invoker,
        subscribe: (): AsyncIterable<LiveFrame<unknown>> => {
          const source = (async function* () {
            yield { control: 'head', state: 'v2.0.1.aaaaaaaa.bbbbbbbb' } as LiveFrame<unknown>;
            yield { event: { type: 'renamed', id: 'card_x', row: {} } };
          })();
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => source.next(),
              return: async () => {
                await onReturn();
                return source.return(undefined);
              },
            }),
          };
        },
      },
    }) as unknown as typeof runtime;

  test('an item the surface refuses ends the stream with internal, as it does over a carrier', async () => {
    const closed = vi.fn(() => Promise.resolve());
    const refusing = refusingRuntime(closed);
    const client = createLocalClient(refusing, { principal: testPrincipal('ada') });
    const stream = collectFrames(client.subscribe('board.card.watch', {} as never));
    await expect(stream.until(() => false, 5000)).rejects.toThrow(/internal/);
    expect(stream.failure()).toMatchObject({ kind: 'internal' });
    expect(stream.frames).toHaveLength(1);
    // The hub's member is released: nothing else returns a stream whose next() rejected.
    expect(closed).toHaveBeenCalledTimes(1);
  });

  test('a stream that fails to close does not hide the refusal', async () => {
    const closing = vi.fn(() => Promise.reject(new Error('the close failed')));
    const client = createLocalClient(refusingRuntime(closing), {
      principal: testPrincipal('ada'),
    });
    const stream = collectFrames(client.subscribe('board.card.watch', {} as never));
    await expect(stream.until(() => false, 5000)).rejects.toThrow(/internal/);
    expect(stream.failure()).toMatchObject({ kind: 'internal' });
    expect(closing).toHaveBeenCalledTimes(1);
  });
});
