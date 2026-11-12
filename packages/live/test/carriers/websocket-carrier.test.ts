import type { CarrierConnection, CarrierOptions, WireError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { websocketCarrier } from '../../src/carriers/websocket/websocket-carrier.ts';
import { fedStream, options, pinned, streamOf } from '../support/carrier-kit.ts';

type Socket = Extract<CarrierConnection, { readonly kind: 'websocket' }>;

function fakeSocket(refuseSend = false) {
  const sent: unknown[] = [];
  const controller = new AbortController();
  const connection: Socket = {
    kind: 'websocket',
    send: async (text) => {
      if (refuseSend) throw new Error('closed');
      sent.push(JSON.parse(text));
    },
    receive: () => ({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
    }),
    ping: async () => true,
    bufferedBytes: () => 0,
    signal: controller.signal,
    close: async () => undefined,
  };
  return { connection, sent, abort: () => controller.abort() };
}

const named: CarrierOptions = { ...options, subscriptionId: 's1' };

describe('the websocket carrier', () => {
  test('frames items, head and gap as data, head and gap messages under the subscription id', async () => {
    const { connection, sent } = fakeSocket();
    await websocketCarrier.serve(
      streamOf([
        { control: 'head', state: 'v2.a' as never },
        { event: { type: 'changed' }, state: 'v2.b' as never },
        { event: 2 },
        { control: 'gap', missed: 3 },
        { control: 'gap' },
      ]).stream,
      connection,
      named,
    );
    expect(websocketCarrier.name).toBe('websocket');
    expect(sent.slice(0, 5)).toEqual([
      { type: 'head', id: 's1', state: 'v2.a' },
      { type: 'data', id: 's1', state: 'v2.b', item: { type: 'changed' } },
      { type: 'data', id: 's1', item: 2 },
      { type: 'gap', id: 's1', missed: 3 },
      { type: 'gap', id: 's1' },
    ]);
  });

  test('a reset is the last message and no end follows it', async () => {
    const { connection, sent } = fakeSocket();
    const { stream, state } = streamOf([
      { control: 'reset', reason: 'resync' },
      { event: 'never sent' },
    ]);
    await websocketCarrier.serve(stream, connection, named);
    expect(sent).toEqual([{ type: 'reset', id: 's1', reason: 'resync' }]);
    expect(state.returned).toBe(true);
  });

  test('a finished stream ends complete; a failed one sends error under its id with the wire error of the options', async () => {
    const done = fakeSocket();
    await websocketCarrier.serve(streamOf([]).stream, done.connection, named);
    expect(done.sent).toEqual([{ type: 'end', id: 's1', reason: 'complete' }]);
    const closed: WireError = {
      kind: 'internal',
      code: 'core.internal',
      message: 'closed',
      retryable: false,
      requestId: 'r',
    };
    const seen: unknown[] = [];
    const failed = fakeSocket();
    await websocketCarrier.serve(
      streamOf([{ event: 1 }], new Error('secret detail')).stream,
      failed.connection,
      {
        ...named,
        wireError: (error) => {
          seen.push(error);
          return closed;
        },
      },
    );
    expect(seen).toHaveLength(1);
    expect(failed.sent).toEqual([
      { type: 'data', id: 's1', item: 1 },
      { type: 'error', id: 's1', error: closed },
    ]);
    const bare = fakeSocket();
    await websocketCarrier.serve(streamOf([{ event: 10n }]).stream, bare.connection, named);
    expect(JSON.stringify(bare.sent)).not.toContain('10');
    expect(bare.sent[0]).toMatchObject({ type: 'error', id: 's1' });
  });

  test('an item above maxBufferedBytes ends with reset overflow and the last token held', async () => {
    const { connection, sent } = fakeSocket();
    await websocketCarrier.serve(
      streamOf([
        { event: 'a', state: 'v2.a' as never },
        { event: 'x'.repeat(500), state: 'v2.b' as never },
      ]).stream,
      connection,
      { ...named, maxBufferedBytes: 200 },
    );
    expect(sent).toEqual([
      { type: 'data', id: 's1', state: 'v2.a', item: 'a' },
      { type: 'reset', id: 's1', reason: 'overflow', state: 'v2.a' },
    ]);
    const first = fakeSocket();
    await websocketCarrier.serve(streamOf([{ event: 'x'.repeat(500) }]).stream, first.connection, {
      ...named,
      maxBufferedBytes: 200,
    });
    expect(first.sent).toEqual([{ type: 'reset', id: 's1', reason: 'overflow' }]);
  });

  test('the deadline ends the stream with end max_duration on the options clock', async () => {
    const { connection, sent } = fakeSocket();
    const { stream, state } = fedStream();
    const kit = pinned();
    const served = websocketCarrier.serve(stream, connection, {
      ...kit.options,
      subscriptionId: 's1',
    });
    await kit.at(0);
    expect(await kit.at(59_999)).toBe(0);
    expect(sent).toEqual([]);
    await kit.at(60_000);
    await served;
    expect(sent).toEqual([{ type: 'end', id: 's1', reason: 'max_duration' }]);
    expect(state.returned).toBe(true);
    expect(kit.timers.pending()).toBe(0);
  });

  test('refuses a connection that is no websocket and options without a subscription id', async () => {
    const { stream } = streamOf([]);
    await expect(
      websocketCarrier.serve(stream, { kind: 'sse' } as never, named),
    ).rejects.toMatchObject({ kind: 'internal' });
    await expect(
      websocketCarrier.serve(stream, fakeSocket().connection, options),
    ).rejects.toMatchObject({ kind: 'internal' });
  });

  test('an aborted connection or a refused send returns and returns the iterator; no wait stays pending', async () => {
    const kit = pinned();
    const aborted = fakeSocket();
    const fed = fedStream();
    const served = websocketCarrier.serve(fed.stream, aborted.connection, {
      ...kit.options,
      subscriptionId: 's1',
    });
    await kit.at(0);
    aborted.abort();
    await served;
    expect(fed.state.returned).toBe(true);
    expect(kit.timers.pending()).toBe(0);
    const refusing = fakeSocket(true);
    const other = streamOf([{ event: 1 }, { event: 2 }]);
    await websocketCarrier.serve(other.stream, refusing.connection, {
      ...kit.options,
      subscriptionId: 's1',
    });
    expect(other.state.returned).toBe(true);
    expect(kit.timers.pending()).toBe(0);
  });
});
