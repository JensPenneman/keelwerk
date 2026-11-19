import type { HttpContext, LiveFrame } from '@keelwerk/core';
import { readEventStream } from '@keelwerk/testing';
import { afterEach, describe, expect, test } from 'vitest';
import { createFakeHost, type FakeHost } from './support/create-fake-host.ts';
import { fakeAction, stringNode } from './support/fake-surface.ts';
import { realSseCarrier } from './support/real-sse-carrier.ts';

const hosts: FakeHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

const action = fakeAction('loans.loanEvents', { kind: 'subscription', output: stringNode });

/** A host with one mounted route that serves a never-ending frame source through `serveStream`, when the context has it. */
function mountedHost(options: { live?: boolean } = {}) {
  const contexts: HttpContext[] = [];
  const returned: boolean[] = [];
  const made = createFakeHost(
    { live: { maxStreamsPerPrincipal: 1 } },
    options.live === false ? {} : { deps: { liveCarrier: () => realSseCarrier() } },
  );
  hosts.push(made);
  made.host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async (_request, ctx) => {
    contexts.push(ctx);
    if (ctx.serveStream === undefined) return new Response('no stream', { status: 400 });
    const frames: AsyncIterable<LiveFrame<unknown>> = {
      [Symbol.asyncIterator]: () => {
        let sent = false;
        return {
          next: () => {
            if (!sent) {
              sent = true;
              return Promise.resolve({ done: false, value: { event: 'one' } });
            }
            return new Promise<IteratorResult<LiveFrame<unknown>>>(() => undefined);
          },
          return: () => {
            returned.push(true);
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
    return ctx.serveStream(frames, { action, surfaceHash: 'hash-1' });
  });
  return { ...made, contexts, returned };
}

const get = (made: FakeHost, headers: Record<string, string> = {}) =>
  made.host.fetch(new Request('https://library.example/api/loans', { headers }), {
    remoteAddress: '198.18.0.5',
  });

describe('a mounted route that serves a stream on the host', () => {
  test('a request that asks for an event stream gets serveStream and opens with retry and welcome', async () => {
    const made = mountedHost();
    const response = await get(made, { accept: 'text/event-stream' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = readEventStream(response);
    const first = await events.next();
    expect(first).toMatchObject({ event: 'welcome', data: { surfaceHash: 'hash-1' } });
    expect(await events.next()).toMatchObject({ event: 'data', data: 'one' });
    await events.close();
  });

  test('without the Accept there is no serveStream, and neither without a live carrier', async () => {
    const plain = mountedHost();
    expect((await get(plain)).status).toBe(400);
    expect(plain.contexts[0]?.serveStream).toBeUndefined();
    const noLive = mountedHost({ live: false });
    expect((await get(noLive, { accept: 'text/event-stream' })).status).toBe(400);
    expect(noLive.contexts[0]?.serveStream).toBeUndefined();
  });

  test('a mounted stream holds the one stream slot and gives it back when the body is cancelled', async () => {
    const made = mountedHost();
    const first = await get(made, { accept: 'text/event-stream' });
    expect(first.status).toBe(200);
    const refused = await get(made, { accept: 'text/event-stream' });
    expect(refused.status).toBe(429);
    await first.body?.cancel();
    await expect.poll(() => made.returned.length).toBe(1);
    const again = await get(made, { accept: 'text/event-stream' });
    expect(again.status).toBe(200);
    await again.body?.cancel();
  });

  test('a mounted stream ends going_away at stop', async () => {
    const made = mountedHost();
    const response = await get(made, { accept: 'text/event-stream' });
    const events = readEventStream(response);
    await events.next();
    expect(await events.next()).toMatchObject({ event: 'data', data: 'one' });
    const stopping = made.host.stop(1000);
    const frames = await events.until((frame) => frame.event === 'end');
    await stopping;
    expect(frames.at(-1)).toMatchObject({ event: 'end', data: { reason: 'going_away' } });
  });

  test('an event whose own member is called control arrives as data and signals nothing', async () => {
    const release = Promise.withResolvers<void>();
    const made = createFakeHost({}, { deps: { liveCarrier: () => realSseCarrier() } });
    hosts.push(made);
    made.host.route(
      { app: 'library', transport: 'rest', prefix: '/api' },
      async (_request, ctx) => {
        const events = ['reset', 'head', 'gap'];
        async function* frames(): AsyncGenerator<LiveFrame<unknown>> {
          for (const control of events) yield { event: { control } };
          await release.promise;
          yield { event: { control: 'later' } };
          await new Promise<void>(() => undefined);
        }
        return ctx.serveStream?.(frames(), { action, surfaceHash: 'hash-1' }) ?? new Response(null);
      },
    );
    const response = await get(made, { accept: 'text/event-stream' });
    const events = readEventStream(response);
    expect((await events.next())?.event).toBe('welcome');
    for (const control of ['reset', 'head', 'gap']) {
      expect(await events.next()).toMatchObject({ event: 'data', data: { control } });
    }
    // Nothing of an event's content is a control signal: no reset, head or end was written, and a later event still comes.
    release.resolve();
    expect(await events.next()).toMatchObject({ event: 'data', data: { control: 'later' } });
    await events.close();
  });
});
