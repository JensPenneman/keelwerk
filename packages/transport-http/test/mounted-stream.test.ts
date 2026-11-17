import { type LoggedLine, recordingLogger } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();
const streamHeaders = { accept: 'text/event-stream' };

function eventStream(): { response: Response; end(): void } {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start: (opened) => {
      controller = opened;
      opened.enqueue(new TextEncoder().encode('data: first\n\n'));
    },
  });
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    end: () => controller?.close(),
  };
}

function mountedHost(lines: LoggedLine[] = []) {
  const made = setup({ live: { maxStreamsPerPrincipal: 1 } }, undefined, {
    log: recordingLogger(lines),
  });
  const streams: { end(): void }[] = [];
  made.host.route({ app: 'library', transport: 'sse-test', prefix: '/events' }, async () => {
    const stream = eventStream();
    streams.push(stream);
    return stream.response;
  });
  return { ...made, streams };
}

const open = (host: ReturnType<typeof setup>['host'], headers: Record<string, string> = {}) =>
  host.fetch(
    new Request('https://library.example/events/x', {
      headers: { ...streamHeaders, ...headers },
    }),
    { remoteAddress: '198.18.0.5' },
  );

describe('a mounted route that streams', () => {
  test('a mounted event-stream response holds a stream slot until its body ends or is cancelled', async () => {
    const { host, streams } = mountedHost();
    const first = await open(host);
    expect(first.status).toBe(200);
    // The one slot of the address is taken: the next stream is refused before the route runs.
    const refused = await open(host);
    expect(refused.status).toBe(429);
    expect(streams).toHaveLength(1);
    // A body that ends gives the slot back.
    streams[0]?.end();
    await first.text();
    const second = await open(host);
    expect(second.status).toBe(200);
    // A cancelled body gives it back too.
    await second.body?.cancel();
    const third = await open(host);
    expect(third.status).toBe(200);
    await third.body?.cancel();
  });

  test('a cross-site GET asking for an event stream with a cookie is core.csrf', async () => {
    const { host, streams } = mountedHost();
    const response = await open(host, {
      cookie: '__Host-kw-test=user:ada',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'core.csrf' } });
    expect(streams).toHaveLength(0);
  });

  test('a route that answers an event stream to a request that did not ask for one is refused', async () => {
    const lines: LoggedLine[] = [];
    const { host, streams } = mountedHost(lines);
    const response = await host.fetch(new Request('https://library.example/events/x'), {
      remoteAddress: '198.18.0.5',
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'core.internal' } });
    expect(streams).toHaveLength(1);
    const failed = lines.filter((line) => line.message === 'request failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: 'error', fields: { code: 'core.internal' } });
  });
});
