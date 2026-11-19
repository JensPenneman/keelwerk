import type { CarrierConnection, LiveFrame } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { sseCarrier } from '../../src/carriers/sse/sse-carrier.ts';
import { websocketCarrier } from '../../src/carriers/websocket/websocket-carrier.ts';
import { fakeConnection, fedStream, options } from '../support/carrier-kit.ts';

type Socket = Extract<CarrierConnection, { readonly kind: 'websocket' }>;

const waitMs = 30_000;

const events: LiveFrame<unknown>[] = [
  { event: { control: 'reset' } },
  { event: { control: 'head', state: 'v2.x' } },
  { event: { control: 'gap', missed: 9 } },
  { event: { control: 'later' } },
];

describe('an item whose event has a member control', () => {
  test('the sse carrier writes it as a data event and goes on', async () => {
    const { connection, written, ends } = fakeConnection();
    const { stream, feed, finish } = fedStream();
    const served = sseCarrier.serve(stream, connection, options);
    feed({ control: 'head', state: 'v2.a' as never });
    for (const frame of events) feed(frame);
    await vi.waitFor(
      () => expect(written.filter((chunk) => chunk.includes('event: data'))).toHaveLength(4),
      {
        timeout: waitMs,
      },
    );
    const frames = written.slice(1);
    expect(frames[0]).toContain('event: head');
    expect(
      frames.slice(1).map((chunk) => chunk.split('\n').find((line) => line.startsWith('event: '))),
    ).toEqual(['event: data', 'event: data', 'event: data', 'event: data']);
    expect(frames.slice(1).map((chunk) => chunk.split('data: ')[1]?.trim())).toEqual([
      '{"control":"reset"}',
      '{"control":"head","state":"v2.x"}',
      '{"control":"gap","missed":9}',
      '{"control":"later"}',
    ]);
    expect(written.some((chunk) => chunk.includes('event: reset'))).toBe(false);
    expect(written.some((chunk) => chunk.includes('event: gap'))).toBe(false);
    expect(ends).toEqual([]);
    finish();
    await served;
  }, 120_000);

  test('the websocket carrier sends it as data under the subscription id and goes on', async () => {
    const sent: { type: string; id: string; item?: unknown }[] = [];
    const controller = new AbortController();
    const connection: Socket = {
      kind: 'websocket',
      send: async (text) => {
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
    const { stream, feed, finish } = fedStream();
    const served = websocketCarrier.serve(stream, connection, { ...options, subscriptionId: 's1' });
    feed({ control: 'head', state: 'v2.a' as never });
    for (const frame of events) feed(frame);
    await vi.waitFor(() => expect(sent).toHaveLength(5), { timeout: waitMs });
    expect(sent[0]).toMatchObject({ type: 'head', id: 's1' });
    expect(sent.slice(1)).toEqual(
      events.map((frame) => ({
        type: 'data',
        id: 's1',
        item: (frame as { event: unknown }).event,
      })),
    );
    finish();
    await served;
  }, 120_000);
});
