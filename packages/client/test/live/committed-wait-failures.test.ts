import { describe, expect, it } from 'vitest';
import { ClientError, createRemoteClient } from '../../src/index.ts';
import type { ProbeApp } from '../support/probe-app.ts';
import { protocolFetch } from '../support/protocol-fetch.ts';
import { surfaceWithWatch } from './support/surface-with-watch.ts';

const welcome = 'event: welcome\ndata: {"protocol":1}\n\n';

/** The retry policy of the cases: no sleep, and `retries` more tries. */
const retryOf = (retries: number) =>
  ({ retries, random: () => 0.5, sleep: () => Promise.resolve() }) as const;

/** A deployment whose `/subscribe` answers `stream`; `shop.ping` commits and lists one effect. */
function deployment(
  stream: () => Response,
  extra: {
    readonly retries?: number;
    readonly live?: 'websocket';
    readonly webSocket?: () => never;
  } = {},
) {
  const server = protocolFetch({
    surface: surfaceWithWatch(true),
    handlers: { 'shop.ping': () => ({ effects: ['eff-1'] }) },
  });
  let posts = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith('/invoke')) posts += 1;
    return path.endsWith('/subscribe') ? stream() : server.fetch(request);
  }) as typeof globalThis.fetch;
  const client = createRemoteClient<ProbeApp>({
    url: 'https://shop.example/',
    apiVersion: '2026-11-01',
    fetch,
    retry: retryOf(extra.retries ?? 2),
    ...(extra.live !== undefined && { live: extra.live }),
    ...(extra.webSocket !== undefined && { webSocket: extra.webSocket }),
  });
  return { client, posts: () => posts };
}

/** A body that fails while it is read, as a connection that a killed server drops. */
const dropping = (): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(welcome));
        controller.error(new TypeError('terminated'));
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

const committedFailure = {
  kind: 'unavailable',
  code: 'core.unavailable',
  retryable: false,
  details: { committed: true, effects: ['eff-1'] },
};

describe('a wait that fails after the command committed', () => {
  it('a status watch whose body fails while it is read: not retryable, with the command id', async () => {
    const { client, posts } = deployment(dropping);
    const attempted = await client.attempt('shop.ping', undefined, { waitEffects: true });
    expect(attempted).toMatchObject({ ok: false, error: committedFailure, effects: ['eff-1'] });
    expect(attempted.commandId).toEqual(expect.any(String));
    expect(posts()).toBe(1);
    const thrown = await client
      .invoke('shop.ping', undefined, { waitEffects: true })
      .catch((failure: unknown) => failure);
    expect(thrown).toBeInstanceOf(ClientError);
    expect(thrown).toMatchObject(committedFailure);
  });

  it('a failure that is no client error at all is core.unavailable with the original as its cause', async () => {
    const original = new Error('no socket');
    const { client } = deployment(() => dropping(), {
      live: 'websocket',
      webSocket: () => {
        throw original;
      },
    });
    const attempted = await client.attempt('shop.ping', undefined, { waitEffects: true });
    expect(attempted).toMatchObject({ ok: false, error: committedFailure });
    expect(attempted.commandId).toEqual(expect.any(String));
    const failure = attempted.ok ? undefined : (attempted.error as { cause?: { cause?: unknown } });
    expect(failure?.cause?.cause).toBe(original);
  });

  it('the caller’s own abort is thrown as it is', async () => {
    const opened = Promise.withResolvers<void>();
    const { client } = deployment(() => {
      opened.resolve();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(welcome));
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    });
    const controller = new AbortController();
    const reason = new Error('stop');
    const waiting = client
      .invoke('shop.ping', undefined, { waitEffects: true, signal: controller.signal })
      .catch((failure: unknown) => failure);
    await opened.promise;
    controller.abort(reason);
    expect(await waiting).toBe(reason);
  });
});

describe('the event stream leg never throws a raw failure', () => {
  it('a request that cannot be sent is core.unavailable with the original as its cause', async () => {
    const original = new TypeError('fetch failed');
    const { client } = deployment(
      () => {
        throw original;
      },
      { retries: 0 },
    );
    const frames = client.subscribe('shop.feed', {})[Symbol.asyncIterator]();
    await expect(frames.next()).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'core.unavailable',
      cause: original,
    });
  });

  it('a body that fails while it is read is core.unavailable with the original as its cause', async () => {
    const { client } = deployment(dropping, { retries: 0 });
    const frames = client.subscribe('shop.feed', {})[Symbol.asyncIterator]();
    const thrown = await frames.next().catch((failure: unknown) => failure);
    expect(thrown).toBeInstanceOf(ClientError);
    expect(thrown).toMatchObject({ code: 'core.unavailable', cause: { message: 'terminated' } });
  });

  it('a malformed event after a frame ends the subscription with core.internal after one open', async () => {
    let opens = 0;
    const { client } = deployment(() => {
      opens += 1;
      // The second open answers the end, so a client that reopens ends the case on what it asserts.
      const text =
        opens === 1
          ? `${welcome}event: head\ndata: {"state":"v2.0.1.00000000.${'0'.repeat(32)}"}\n\nevent: data\ndata: not json\n\n`
          : `${welcome}event: end\ndata: {"reason":"complete"}\n\n`;
      return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const frames = client.subscribe('shop.feed', {})[Symbol.asyncIterator]();
    const outcome = await (async () => {
      for (;;) if ((await frames.next()).done === true) return 'ended';
    })().then(
      (ended) => ended,
      (failure: unknown) => (failure as { code?: string }).code,
    );
    expect({ outcome, opens }).toEqual({ outcome: 'core.internal', opens: 1 });
  });
});
