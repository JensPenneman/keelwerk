import { requestHeaders, startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { orpcEchoApp } from './support/orpc-echo-app.ts';

/**
 * The size of a request body at the oRPC handlers. The transport reads no body itself: the host
 * reads every body of a mounted route (any method but GET and HEAD; the host answers TRACE
 * itself and serves no handler) before the route is chosen, never beyond its `maxBodyBytes`, and hands the
 * handler a request rebuilt from the bytes it read, an empty body when none arrived. These tests run
 * both handlers behind the real host, as the app runs them.
 */
const limit = 2048;
const chunk = 256;
const openapi = '/orpc-openapi';
const runtime = await startTransportRuntime({
  app: orpcEchoApp({ openapi }),
  host: httpHost({ maxBodyBytes: limit }),
  config: { orpc: { cors: [] } },
});
afterAll(() => runtime.stop());

const handlers = [
  { name: 'the RPC handler', path: '/orpc/echo/mirror', rpc: true },
  { name: 'the OpenAPI handler', path: `${openapi}/echo/mirror`, rpc: false },
] as const;

/** The input of `echo.mirror` with a label long enough to make the body `size` bytes (ASCII). */
function bodyOf(rpc: boolean, size: number): string {
  const make = (label: string): string => {
    const input = {
      at: '2026-11-12T10:00:00.000Z',
      on: '2026-11-12',
      big: '9007199254740993',
      bytes: 'AQID',
      tags: ['a'],
      label,
    };
    return JSON.stringify(rpc ? { json: input, meta: [] } : input);
  };
  const bare = make('').length;
  if (size < bare) throw new Error('The size is below the smallest body.');
  return make('x'.repeat(size - bare));
}

function request(
  path: string,
  body: string | ReadableStream<Uint8Array>,
  extra: Record<string, string> = {},
): Request {
  const headers = requestHeaders({ subject: 'ada' });
  headers.set('content-type', 'application/json');
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Request(`https://${runtime.domains.acme}${path}`, {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  } as RequestInit);
}

/** A body that produces `chunk` bytes per pull, forever, and counts what was pulled and whether it was cancelled. */
function endless(): {
  body: ReadableStream<Uint8Array>;
  seen: { pulled: number; cancelled: boolean };
} {
  const seen = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulled += chunk;
        controller.enqueue(new TextEncoder().encode('x'.repeat(chunk)));
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, seen };
}

async function code(answer: Response): Promise<string | undefined> {
  const body = (await answer.json()) as { code?: string; error?: { code?: string } };
  return body.code ?? body.error?.code;
}

describe.each(handlers)('the body bound of $name', ({ path, rpc }) => {
  test('a body with a content-length above the limit is refused 413 before it is read', async () => {
    const { body, seen } = endless();
    const answer = await runtime.fetch(
      request(path, body, { 'content-length': String(limit + 1) }),
    );
    expect(answer.status).toBe(413);
    expect(await code(answer)).toBe('core.payload_too_large');
    expect(seen.pulled).toBe(0);
  });

  test('a declared oversized body of text is refused 413', async () => {
    const text = bodyOf(rpc, limit + 1);
    const answer = await runtime.fetch(
      request(path, text, { 'content-length': String(text.length) }),
    );
    expect(answer.status).toBe(413);
    expect(await code(answer)).toBe('core.payload_too_large');
  });

  test('a body without a content-length is cut at the first byte over the limit and never read further', async () => {
    const { body, seen } = endless();
    const answer = await runtime.fetch(request(path, body));
    expect(answer.status).toBe(413);
    expect(await code(answer)).toBe('core.payload_too_large');
    expect(seen.pulled).toBeGreaterThan(limit);
    expect(seen.pulled).toBeLessThanOrEqual(limit + chunk);
    expect(seen.cancelled).toBe(true);
  });

  test('a body of exactly the limit is served', async () => {
    const text = bodyOf(rpc, limit);
    expect(text.length).toBe(limit);
    const answer = await runtime.fetch(request(path, text, { 'content-length': String(limit) }));
    expect(answer.status).toBe(200);
  });

  test('a body of one byte over the limit is refused with and without a content-length', async () => {
    const text = bodyOf(rpc, limit + 1);
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
    const answer = await runtime.fetch(request(path, streamed));
    expect(answer.status).toBe(413);
    expect(await code(answer)).toBe('core.payload_too_large');
  });
});
