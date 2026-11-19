import type { HttpContext } from '@keelwerk/core';
import { type LoggedLine, recordingLogger } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();
const jsonl = { 'trpc-accept': 'application/jsonl' };
const address = { remoteAddress: '198.18.0.5' };
const encoder = new TextEncoder();

interface Opened {
  end(): void;
}

function jsonLines(): { response: Response; end(): void; cancelled: () => boolean } {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start: (opened) => {
      controller = opened;
      opened.enqueue(encoder.encode('{"a":1}\n'));
    },
    cancel: () => {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, {
      headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    }),
    end: () => controller?.close(),
    cancelled: () => cancelled,
  };
}

function jsonlHost(lines: LoggedLine[] = [], answer?: (calls: number) => Response) {
  const made = setup({ live: { maxStreamsPerPrincipal: 1 } }, undefined, {
    log: recordingLogger(lines),
  });
  const opened: Opened[] = [];
  const contexts: { request: Request; context: HttpContext }[] = [];
  made.host.route(
    {
      app: 'library',
      transport: 'trpc-test',
      prefix: '/trpc',
      streams: (request) => request.headers.get('trpc-accept') === 'application/jsonl',
    },
    async (request, context) => {
      contexts.push({ request, context });
      if (answer !== undefined) return answer(contexts.length);
      const stream = jsonLines();
      opened.push(stream);
      return stream.response;
    },
  );
  return { ...made, opened, contexts };
}

const get = (host: ReturnType<typeof setup>['host'], headers: Record<string, string> = {}) =>
  host.fetch(
    new Request('https://library.example/trpc/greet.stream?batch=1', { headers }),
    address,
  );

describe('a route that declares its streams', () => {
  test('a request the predicate accepts holds a stream slot until its body ends or is cancelled', async () => {
    const { host, opened, contexts } = jsonlHost();
    const first = await get(host, jsonl);
    expect(first.status).toBe(200);
    expect((await get(host, jsonl)).status).toBe(429);
    expect(contexts).toHaveLength(1);
    opened[0]?.end();
    await first.text();
    const second = await get(host, jsonl);
    expect(second.status).toBe(200);
    await second.body?.cancel();
    const fourth = await get(host, jsonl);
    expect(fourth.status).toBe(200);
    await fourth.body?.cancel();
  });

  test('the predicate gets the request as received and the path relative to the mount', async () => {
    const seen: { url: string; path: string }[] = [];
    const made = setup();
    made.host.route(
      {
        app: 'library',
        transport: 'trpc-test',
        prefix: '/trpc',
        streams: (request, path) => {
          seen.push({ url: request.url, path });
          return false;
        },
      },
      async () => Response.json({ ok: true }),
    );
    const response = await get(made.host);
    expect(response.status).toBe(200);
    expect(seen).toEqual([
      { url: 'https://library.example/trpc/greet.stream?batch=1', path: '/greet.stream' },
    ]);
  });

  test('a cross-site GET the predicate accepts meets the stream origin check', async () => {
    const { host, contexts } = jsonlHost();
    const cross = {
      cookie: '__Host-kw-test=user:ada',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    };
    const refused = await get(host, { ...cross, ...jsonl });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'core.csrf' } });
    expect(contexts).toHaveLength(0);
    const plain = jsonlHost([], () => Response.json({ ok: true }));
    expect((await get(plain.host, cross)).status).toBe(200);
  });

  test('a request the predicate refuses takes no slot', async () => {
    const { host } = jsonlHost([], (calls) =>
      calls === 1 ? jsonLines().response : Response.json({ ok: true }),
    );
    const first = await get(host, jsonl);
    expect(first.status).toBe(200);
    const plain = await get(host);
    expect(plain.status).toBe(200);
    expect(await plain.json()).toEqual({ ok: true });
    expect((await get(host, jsonl)).status).toBe(429);
    await first.body?.cancel();
  });

  const shapes: [string, Record<string, string>][] = [
    ['chunked', { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }],
    ['multipart/mixed', { 'content-type': 'multipart/mixed; boundary="-"' }],
    ['application/jsonl', { 'content-type': 'application/jsonl' }],
    ['application/x-ndjson', { 'content-type': 'application/x-ndjson' }],
    ['application/json-seq', { 'content-type': 'application/json-seq' }],
    ['text/event-stream', { 'content-type': 'text/event-stream' }],
  ];
  test.each(shapes)(
    'a stream-shaped answer (%s) to a request the route did not count is refused',
    async (_name, headers) => {
      const lines: LoggedLine[] = [];
      const made = setup({}, undefined, { log: recordingLogger(lines) });
      let cancelled = false;
      made.host.route({ app: 'library', transport: 'plain-test', prefix: '/plain' }, async () => {
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => controller.enqueue(encoder.encode('x\n')),
          cancel: () => {
            cancelled = true;
          },
        });
        return new Response(body, { headers });
      });
      const response = await made.host.fetch(
        new Request('https://library.example/plain/x'),
        address,
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: 'core.internal' } });
      expect(cancelled).toBe(true);
      const failed = lines.filter((line) => line.message === 'request failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ level: 'error', fields: { code: 'core.internal' } });
    },
  );

  test('a stream-shaped answer from a route with a predicate to a request it refused is refused', async () => {
    const lines: LoggedLine[] = [];
    let cancelled = false;
    const { host } = jsonlHost(lines, () => {
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(encoder.encode('data: x\n\n')),
        cancel: () => {
          cancelled = true;
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    const response = await get(host);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'core.internal' } });
    expect(cancelled).toBe(true);
    expect(lines.filter((line) => line.message === 'request failed')).toHaveLength(1);
  });

  test('a declared predicate replaces the event-stream default', async () => {
    const { host } = jsonlHost([], (calls) =>
      calls === 1 ? jsonLines().response : Response.json({ ok: true }),
    );
    const first = await get(host, jsonl);
    expect(first.status).toBe(200);
    const sse = await get(host, { accept: 'text/event-stream' });
    expect(sse.status).toBe(200);
    expect(await sse.json()).toEqual({ ok: true });
    expect((await get(host, jsonl)).status).toBe(429);
    await first.body?.cancel();
  });

  test('a counted stream is never compressed', async () => {
    const { host, opened } = jsonlHost();
    const response = await get(host, { ...jsonl, 'accept-encoding': 'gzip, br' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBeNull();
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe('{"a":1}\n');
    await reader?.cancel();
    expect(opened).toHaveLength(1);
  });

  test('a predicate that throws answers core.internal and the route does not run', async () => {
    const made = setup();
    let ran = false;
    made.host.route(
      {
        app: 'library',
        transport: 'trpc-test',
        prefix: '/trpc',
        streams: () => {
          throw new Error('predicate failed');
        },
      },
      async () => {
        ran = true;
        return Response.json({});
      },
    );
    const response = await get(made.host);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'core.internal' } });
    expect(ran).toBe(false);
  });
});
