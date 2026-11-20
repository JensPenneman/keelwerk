import { connect } from 'node:net';
import { defineApiVersions, defineApp } from '@keelwerk/core';
import { requestHeaders, startTransportRuntime } from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { graphql } from '@keelwerk/transport-graphql';
import { httpHost } from '@keelwerk/transport-http';
import { orpcTransport } from '@keelwerk/transport-orpc';
import { rest } from '@keelwerk/transport-rest';
import { trpc } from '@keelwerk/transport-trpc';
import { afterAll, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

/**
 * A POST without a body, over a listening socket, to a route of every mount kind. Over a socket the
 * host's server gives such a request a body stream of zero bytes, which the host reads before the
 * route is chosen; the handler must still get a request it can read. Each row is the answer its
 * handler gives to the empty body, the same as `host.fetch` gives a request that has no body member.
 */
const app = defineApp({
  id: 'bodyless',
  modules: [library, loans, rest, graphql, trpc, orpcTransport({ openapi: '/orpc-openapi' })],
  api: defineApiVersions({ '2026-11-11': {} }),
});
const runtime = await startTransportRuntime({
  app,
  host: httpHost({ listen: { port: 0 } }),
  config: {
    rest: { docs: false, cors: [] },
    graphql: { cors: [] },
    trpc: { cors: [] },
    orpc: { cors: [] },
  },
});
afterAll(() => runtime.stop());

/** How a request says it has no body: the three framings an HTTP/1.1 client can use. */
const framings = {
  'Content-Length: 0': { header: 'Content-Length: 0\r\n', body: '' },
  'no length at all': { header: '', body: '' },
  'chunked, the last chunk only': { header: 'Transfer-Encoding: chunked\r\n', body: '0\r\n\r\n' },
} as const;

interface Answer {
  readonly status: number;
  /**
   * The payload text: the test parses it after the status assertion, so an answer that is no JSON
   * fails the test instead of throwing in the socket listener.
   */
  readonly text: string;
}

/** The request text in one write, `Connection: close`; the answer is read until the server ends the socket. */
function post(
  path: string,
  { header, body }: (typeof framings)[keyof typeof framings],
  method = 'POST',
): Promise<Answer> {
  const headers = requestHeaders({ subject: 'ada' });
  headers.set('content-type', 'application/json');
  const fields = [...headers].map(([name, value]) => `${name}: ${value}\r\n`).join('');
  const text = `${method} ${path} HTTP/1.1\r\nHost: ${runtime.domains.acme}\r\nConnection: close\r\n${fields}${header}\r\n${body}`;
  return new Promise((resolve, reject) => {
    const socket = connect(runtime.runtime.port ?? 0, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('end', () => {
      const answer = Buffer.concat(chunks).toString('utf8');
      const [head = '', payload = ''] = answer.split('\r\n\r\n', 2);
      const status = Number(head.split(' ', 2)[1]);
      // The payload is chunk-framed when the host streams it: take the text between the braces.
      resolve({ status, text: payload.slice(payload.indexOf('{'), payload.lastIndexOf('}') + 1) });
    });
    socket.on('error', reject);
    socket.write(text);
  });
}

const rows = [
  {
    mount: 'REST',
    path: '/api/loans/lend',
    status: 422,
    shows: (body: unknown) => expect(body).toMatchObject({ code: 'core.validation' }),
  },
  {
    mount: 'GraphQL',
    path: '/graphql',
    status: 400,
    shows: (body: unknown) =>
      expect(body).toMatchObject({
        errors: [{ extensions: { keelwerk: { code: 'core.malformed_request' } } }],
      }),
  },
  {
    mount: 'tRPC',
    path: '/trpc/loans.lend',
    status: 400,
    shows: (body: unknown) =>
      expect(body).toMatchObject({
        error: { json: { data: { keelwerk: { code: 'core.validation' } } } },
      }),
  },
  {
    mount: 'oRPC RPC',
    path: '/orpc/loans/about',
    status: 200,
    shows: (body: unknown) => expect(body).toEqual({ json: { module: 'loans' } }),
  },
  {
    mount: 'oRPC OpenAPI',
    path: '/orpc-openapi/loans/about',
    status: 200,
    shows: (body: unknown) => expect(body).toEqual({ module: 'loans' }),
  },
  {
    mount: 'invoke',
    path: '/_keelwerk/v1/invoke',
    status: 400,
    shows: (body: unknown) =>
      expect(body).toMatchObject({ ok: false, error: { code: 'core.malformed_request' } }),
  },
] as const;

describe('a POST without a body over a listening socket', () => {
  for (const row of rows) {
    test.each(Object.entries(framings))(
      `${row.mount} answers what its handler gives to an empty body: %s`,
      async (_name, framing) => {
        const answer = await post(row.path, framing);
        expect(answer.status).toBe(row.status);
        row.shows(JSON.parse(answer.text));
      },
    );
  }
});

describe('a TRACE to a tRPC route over a listening socket', () => {
  test('is answered by the host itself: 405 core.unsupported', async () => {
    const answer = await post('/trpc/loans.lend', framings['Content-Length: 0'], 'TRACE');
    expect(answer.status).toBe(405);
    expect(JSON.parse(answer.text)).toMatchObject({ error: { code: 'core.unsupported' } });
  });
});
