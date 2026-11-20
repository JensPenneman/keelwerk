import { describe, expect, it } from 'vitest';
import { createRemoteClient } from '../../src/index.ts';
import type { ProbeApp } from '../support/probe-app.ts';
import { protocolFetch } from '../support/protocol-fetch.ts';
import { surfaceWithWatch } from './support/surface-with-watch.ts';

const noWait = { retries: 3, random: () => 0.5, sleep: () => Promise.resolve() } as const;
const welcome = 'event: welcome\ndata: {"protocol":1}\n\n';
const token = `v2.0.1.00000000.${'0'.repeat(32)}`;

/** A deployment whose `/subscribe` answers `stream`; `shop.ping` commits and lists one effect. */
function deployment(stream: () => Response) {
  const server = protocolFetch({
    surface: surfaceWithWatch(true),
    handlers: { 'shop.ping': () => ({ effects: ['eff-1'] }) },
  });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    return new URL(request.url).pathname.endsWith('/subscribe') ? stream() : server.fetch(request);
  }) as typeof globalThis.fetch;
  return createRemoteClient<ProbeApp>({
    url: 'https://shop.example/',
    apiVersion: '2026-11-01',
    fetch,
    retry: noWait,
  });
}

const sse = (text: string): Response =>
  new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });

describe('invoke with waitEffects when the effects did not settle', () => {
  it('a watch that closes complete before the head is client.effects_unsettled, not a result and never core.timeout', async () => {
    const client = deployment(() => sse(`${welcome}event: end\ndata: {"reason":"complete"}\n\n`));
    const attempted = await client.attempt('shop.ping', undefined, { waitEffects: true });
    expect(attempted).toMatchObject({
      ok: false,
      error: {
        kind: 'unavailable',
        code: 'client.effects_unsettled',
        retryable: false,
        details: { committed: true, effects: ['eff-1'] },
      },
      effects: ['eff-1'],
    });
    expect(attempted.commandId).toEqual(expect.any(String));
    await expect(
      client.invoke('shop.ping', undefined, { waitEffects: true }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'client.effects_unsettled',
      retryable: false,
      details: { committed: true, commandId: expect.any(String), effects: ['eff-1'] },
    });
  });

  it('an error event of the watch that says core.timeout is client.effects_unsettled too, with the original as cause', async () => {
    const timeout =
      'event: error\ndata: {"kind":"unavailable","code":"core.timeout","message":"Too slow.","retryable":true,"requestId":"r"}\n\n';
    const client = deployment(() => sse(`${welcome}${timeout}`));
    const attempted = await client.attempt('shop.ping', undefined, { waitEffects: true });
    expect(attempted).toMatchObject({
      ok: false,
      error: {
        kind: 'unavailable',
        code: 'client.effects_unsettled',
        retryable: false,
        details: { committed: true, effects: ['eff-1'] },
        cause: { code: 'core.timeout' },
      },
      effects: ['eff-1'],
    });
    expect(attempted.commandId).toEqual(expect.any(String));
    await expect(
      client.invoke('shop.ping', undefined, { waitEffects: true }),
    ).rejects.toMatchObject({
      code: 'client.effects_unsettled',
      retryable: false,
      details: { committed: true },
    });
  });
});

describe('a subscription whose item does not decode', () => {
  it('closes the connection before it throws, and ends', async () => {
    let cancelled = false;
    const client = deployment(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(`${welcome}id: ${token}\nevent: data\ndata: 5\n\n`),
              );
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const frames = client.subscribe('shop.feed', {})[Symbol.asyncIterator]();
    await expect(frames.next()).rejects.toMatchObject({ kind: 'internal' });
    expect(cancelled).toBe(true);
    expect(await frames.next()).toEqual({ done: true, value: undefined });
  });
});
