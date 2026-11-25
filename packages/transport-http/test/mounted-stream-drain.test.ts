import { type LoggedLine, recordingLogger } from '@keelwerk/testing';
import { describe, expect, test, vi } from 'vitest';
import { drained } from './support/drained.ts';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { libraryActions } from './support/library-actions.ts';
import { pinnedTime } from './support/pinned-time.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();
const waitMs = 30_000;
const encoder = new TextEncoder();
const lines3 = ['{"a":1}\n', '{"a":2}\n', '{"a":3}\n'];
const address = { remoteAddress: '198.18.0.5' };

/** What the tRPC server sends for a JSON-lines batch: `application/json`, chunked; a second row sends `application/jsonl`. */
const bodyTypes = ['application/json', 'application/jsonl'] as const;

function chunked(
  contentType: string,
  preloaded: boolean,
): {
  response: Response;
  push(text: string): void;
  end(): void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start: (opened) => {
        controller = opened;
        if (preloaded) {
          for (const text of lines3) opened.enqueue(encoder.encode(text));
          opened.close();
        }
      },
    }),
    { headers: { 'content-type': contentType, 'transfer-encoding': 'chunked' } },
  );
  return {
    response,
    push: (text) => controller?.enqueue(encoder.encode(text)),
    end: () => controller?.close(),
  };
}

function drainHost(
  contentType: string,
  options: { preloaded: boolean; gate?: Promise<void>; entered?: () => void },
) {
  const lines: LoggedLine[] = [];
  const time = pinnedTime();
  const made = setup(
    { live: { maxDurationMs: 86_400_000, maxStreamsPerPrincipal: 1 } },
    createFakeInvoker({ actions: libraryActions }),
    { clock: time.clock, timers: time.timers, log: recordingLogger(lines) },
  );
  const requests: string[] = [];
  const bodies: ReturnType<typeof chunked>[] = [];
  made.host.route(
    {
      app: 'library',
      transport: 'trpc-test',
      prefix: '/trpc',
      streams: (request) => request.headers.get('trpc-accept') === 'application/jsonl',
    },
    async (request) => {
      requests.push(request.url);
      options.entered?.();
      await options.gate;
      const body = chunked(contentType, options.preloaded);
      bodies.push(body);
      return body.response;
    },
  );
  made.host.route({ app: 'library', transport: 'sse-test', prefix: '/events' }, async () => {
    return new Response(
      new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(encoder.encode('data: first\n\n')),
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const batch = () =>
    made.host.fetch(
      new Request('https://library.example/trpc/loans.lend?batch=1', {
        headers: { 'trpc-accept': 'application/jsonl' },
      }),
      address,
    );
  const events = () =>
    made.host.fetch(
      new Request('https://library.example/events/x', { headers: { accept: 'text/event-stream' } }),
      { remoteAddress: '198.18.0.6' },
    );
  const goodbyes = (): LoggedLine[] =>
    lines.filter((line) => line.message === 'stream ended by the host');
  return { ...made, timers: time.timers, requests, bodies, batch, events, goodbyes };
}

describe.each(bodyTypes)(
  'at the stop of the host, a counted %s body that is not an event stream',
  (type) => {
    test('drains until its end, every chunk reaches the client, the slot is free and nothing is logged; an event stream ends at once', async () => {
      const { host, bodies, requests, batch, events, goodbyes, timers } = drainHost(type, {
        preloaded: false,
      });
      const jsonl = await batch();
      const sse = await events();
      expect(jsonl.status).toBe(200);
      expect(requests).toHaveLength(1);
      const received = drained(jsonl);
      const sseBody = drained(sse);
      const stopping = host.stop(5_000);
      // The event stream is told to go away at once; the batch is not.
      expect(await sseBody).toBe('data: first\n\n');
      expect(goodbyes().map((line) => line.fields?.reason)).toEqual(['going_away']);
      for (const text of lines3) {
        bodies[0]?.push(text);
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(goodbyes()).toHaveLength(1);
      bodies[0]?.end();
      expect(await received).toBe(lines3.join(''));
      await stopping;
      expect(goodbyes().map((line) => line.fields?.reason)).toEqual(['going_away']);
      expect(requests).toHaveLength(1);
      // The slot of the batch was released when its body ended: no wait of it is left.
      expect(timers.pending()).toBe(0);
    }, 120_000);

    test('a stop that began while the route runs does not cut the body either, and the slot is free afterwards', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered = false;
      const { host, batch, goodbyes, requests, timers } = drainHost(type, {
        preloaded: true,
        gate,
        entered: () => {
          entered = true;
        },
      });
      const asked = batch();
      await vi.waitFor(() => expect(entered).toBe(true), { timeout: waitMs });
      const stopping = host.stop(5_000);
      release();
      const response = await asked;
      expect(await drained(response)).toBe(lines3.join(''));
      await stopping;
      expect(goodbyes()).toEqual([]);
      expect(requests).toHaveLength(1);
      expect(timers.pending()).toBe(0);
    }, 120_000);
  },
);
