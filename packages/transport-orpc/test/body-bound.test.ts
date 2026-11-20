import {
  deriveSurface,
  type HttpHandler,
  type MountContext,
  versionProjection,
} from '@keelwerk/core';
import { requestHeaders, startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { mountOrpc } from '../src/mount/mount-orpc.ts';
import type { OrpcConfig } from '../src/orpc-config.ts';
import { orpcEchoApp } from './support/orpc-echo-app.ts';

/**
 * The size of a request body at the oRPC handlers, at the two bounds it meets. The host reads every
 * body of a mounted route (any method but GET and HEAD; the host answers TRACE itself and serves no
 * handler) before the route is chosen, never beyond its `maxBodyBytes`, and hands the handler a
 * request rebuilt from the bytes it read, an empty body when none arrived. The transport then reads
 * that body within the `maxBodyBytes` of its own config. The first tests set the bound on the host,
 * the second set it in the `orpc` config of a backend behind a host with the default bound, and the
 * last mount the handlers with a hand-built context, where the request is the client's own stream:
 * what is pulled from it and whether it is cancelled show only there.
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
  target: typeof runtime,
  path: string,
  body: string | ReadableStream<Uint8Array>,
  extra: Record<string, string> = {},
): Request {
  const headers = requestHeaders({ subject: 'ada' });
  headers.set('content-type', 'application/json');
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Request(`https://${target.domains.acme}${path}`, {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  } as RequestInit);
}

/**
 * A body that produces `chunk` bytes per pull and counts what was pulled and whether it was
 * cancelled. It closes after 16 times `limit` bytes, so a bound that is not kept ends in an
 * assertion within milliseconds and not in a reader that never ends.
 */
function endless(): {
  body: ReadableStream<Uint8Array>;
  seen: { pulled: number; cancelled: boolean };
} {
  const seen = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (seen.pulled >= limit * 16) {
          controller.close();
          return;
        }
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

/** A body that arrives as one chunk and has no declared length. */
function oneChunk(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

async function code(answer: Response): Promise<string | undefined> {
  const body = (await answer.json()) as { code?: string; error?: { code?: string } };
  return body.code ?? body.error?.code;
}

describe.each(handlers)('the body bound of $name', ({ path, rpc }) => {
  test('a body with a content-length above the limit is refused 413 before it is read', async () => {
    const { body, seen } = endless();
    const answer = await runtime.fetch(
      request(runtime, path, body, { 'content-length': String(limit + 1) }),
    );
    expect(answer.status).toBe(413);
    expect(await code(answer)).toBe('core.payload_too_large');
    expect(seen.pulled).toBe(0);
  });

  test('a declared oversized body of text is refused 413', async () => {
    const text = bodyOf(rpc, limit + 1);
    const answer = await runtime.fetch(
      request(runtime, path, text, { 'content-length': String(text.length) }),
    );
    expect(answer.status).toBe(413);
    expect(await code(answer)).toBe('core.payload_too_large');
  });

  test('a body without a content-length is cut at the first byte over the limit and never read further', async () => {
    const { body, seen } = endless();
    const answer = await runtime.fetch(request(runtime, path, body));
    expect(answer.status).toBe(413);
    expect(await code(answer)).toBe('core.payload_too_large');
    expect(seen.pulled).toBeGreaterThan(limit);
    expect(seen.pulled).toBeLessThanOrEqual(limit + chunk);
    expect(seen.cancelled).toBe(true);
  });

  test('a body of exactly the limit is served', async () => {
    const text = bodyOf(rpc, limit);
    expect(text.length).toBe(limit);
    const answer = await runtime.fetch(
      request(runtime, path, text, { 'content-length': String(limit) }),
    );
    expect(answer.status).toBe(200);
  });

  test('a body of one byte over the limit without a content-length is refused 413', async () => {
    const text = bodyOf(rpc, limit + 1);
    const streamed = oneChunk(text);
    const answer = await runtime.fetch(request(runtime, path, streamed));
    expect(answer.status).toBe(413);
    expect(await code(answer)).toBe('core.payload_too_large');
  });
});

const configuredRuntime = await startTransportRuntime({
  app: orpcEchoApp({ openapi }),
  host: httpHost(),
  config: { orpc: { cors: [], maxBodyBytes: limit } },
});
afterAll(() => configuredRuntime.stop());

/**
 * The error code in the transport's form (`json.code` of the RPC handler, `code` of the OpenAPI
 * handler), not the host's envelope.
 */
async function transportCode(answer: Response, rpc: boolean): Promise<string | undefined> {
  const body = (await answer.json()) as { code?: string; json?: { code?: string } };
  return rpc ? body.json?.code : body.code;
}

describe.each(handlers)('the maxBodyBytes of the orpc config at $name', ({ path, rpc }) => {
  test('a body of exactly the bound is served', async () => {
    const text = bodyOf(rpc, limit);
    const answer = await configuredRuntime.fetch(
      request(configuredRuntime, path, text, { 'content-length': String(limit) }),
    );
    expect(answer.status).toBe(200);
  });

  test('a body of one byte over the bound with a content-length is refused 413', async () => {
    const text = bodyOf(rpc, limit + 1);
    const answer = await configuredRuntime.fetch(
      request(configuredRuntime, path, text, { 'content-length': String(text.length) }),
    );
    expect(answer.status).toBe(413);
    expect(await transportCode(answer, rpc)).toBe('core.payload_too_large');
  });

  test('a body of one byte over the bound without a content-length is refused 413', async () => {
    const text = bodyOf(rpc, limit + 1);
    const streamed = oneChunk(text);
    const answer = await configuredRuntime.fetch(request(configuredRuntime, path, streamed));
    expect(answer.status).toBe(413);
    expect(await transportCode(answer, rpc)).toBe('core.payload_too_large');
  });
});

const surface = deriveSurface(orpcEchoApp({ openapi }), '2026-11-11').surface;
const routes: { prefix: string; handler: HttpHandler }[] = [];
await mountOrpc(
  {
    app: 'orpc-echo',
    surface,
    surfaces: versionProjection([surface.apiVersion], () => surface),
    invoker: {},
    host: {
      route: (spec: { prefix: string }, handler: HttpHandler) =>
        routes.push({ prefix: spec.prefix, handler }),
    },
    config: () => ({ cors: [], maxBodyBytes: limit }),
    log: { error: () => undefined },
  } as unknown as MountContext<OrpcConfig>,
  { openapi },
);

const mounted = [
  { name: 'the RPC handler', prefix: '/orpc', path: '/echo/mirror', rpc: true },
  { name: 'the OpenAPI handler', prefix: openapi, path: '/echo/mirror', rpc: false },
] as const;

/** Calls the mounted handler with the client's own request, as the host would forward it. */
async function mountedCall(
  prefix: string,
  path: string,
  body: ReadableStream<Uint8Array>,
  extra: Record<string, string>,
): Promise<Response> {
  const route = routes.find((candidate) => candidate.prefix === prefix);
  if (route === undefined) throw new Error(`The transport registered no route at ${prefix}.`);
  const request = new Request(`https://acme.example.test${prefix}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extra },
    body,
    duplex: 'half',
  } as RequestInit);
  return route.handler(request, {
    session: { apiVersion: surface.apiVersion, principal: { kind: 'user', subject: 'ada' } },
    carrier: { transport: 'http', headers: {} },
    requestId: '0192a000-0000-7000-8000-000000000001',
    signal: new AbortController().signal,
    path,
    basePath: prefix,
  } as never);
}

describe.each(mounted)('the orpc bound without the host at $name', ({ prefix, path, rpc }) => {
  test('a content-length above the bound is refused 413 with nothing pulled', async () => {
    const { body, seen } = endless();
    const answer = await mountedCall(prefix, path, body, {
      'content-length': String(limit + 1),
    });
    expect(answer.status).toBe(413);
    expect(await transportCode(answer, rpc)).toBe('core.payload_too_large');
    expect(seen.pulled).toBe(0);
  });

  test('a body without a content-length is cut at the first chunk over the bound and cancelled', async () => {
    const { body, seen } = endless();
    const answer = await mountedCall(prefix, path, body, {});
    expect(answer.status).toBe(413);
    expect(await transportCode(answer, rpc)).toBe('core.payload_too_large');
    expect(seen.pulled).toBeGreaterThan(limit);
    expect(seen.pulled).toBeLessThanOrEqual(limit + chunk);
    expect(seen.cancelled).toBe(true);
  });
});
