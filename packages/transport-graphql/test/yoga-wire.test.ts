import { request } from 'node:http';
import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { graphqlConformanceApp } from './support/graphql-conformance-app.ts';
import { ask, mountedGraphql, sendGraphql, transportSurface } from './support/graphql-kit.ts';

const surface = transportSurface();
/** The header names of an answer, sorted; `Headers.keys()` is already lower-case. */
function headerNames(headers: Headers): string[] {
  return [...headers.keys()].toSorted();
}

const origins = ['https://app.example.test'];
const runtime = await startTransportRuntime({
  app: graphqlConformanceApp,
  host: httpHost({ listen: { port: 0 }, trustedProxies: ['127.0.0.1'] }),
  config: { graphql: { cors: origins, websocket: true } },
  tenants: ['acme'],
});
afterAll(() => runtime.stop());

interface ServedAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

/** One request over the host's real TCP listener, so the framing of the answer is the one a client sees. */
function serve(method: 'GET' | 'POST', headers: Record<string, string>, body?: string) {
  const port = runtime.runtime.port;
  const domain = runtime.domains.acme;
  return new Promise<ServedAnswer>((resolve, reject) => {
    const outgoing = request(
      {
        host: '127.0.0.1',
        port,
        path: '/graphql',
        method,
        headers: { host: domain ?? '', ...headers },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

const respond = () => ({ ok: true as const, value: undefined });

describe('the wire of the GraphQL engine', () => {
  test('the Yoga instance makes no request id: a sent x-request-id is not echoed', async () => {
    const { handler } = await mountedGraphql(surface, respond);
    const answer = await ask(handler, '{ __typename }', undefined, {
      headers: { 'x-request-id': 'forged' },
    });
    expect(answer.headers.get('x-request-id')).toBeNull();
  });

  test('a query answer carries the headers it carried under Yoga 5', async () => {
    const { handler } = await mountedGraphql(surface, respond);
    const answer = await ask(handler, '{ __typename }');
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(headerNames(answer.headers)).toEqual(['content-length', 'content-type']);
  });

  test('the GraphiQL page of development carries the headers it carried under Yoga 5', async () => {
    const { handler } = await mountedGraphql(surface, respond, { development: true });
    const response = await sendGraphql(handler, undefined, {
      method: 'GET',
      headers: { accept: 'text/html' },
    });
    await response.text();
    expect(response.status).toBe(200);
    expect(headerNames(response.headers)).toEqual(['content-length', 'content-type']);
  });

  test('the host serves JSON and GraphiQL answers with a content-length and no chunked framing', async () => {
    const query = await serve(
      'POST',
      { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      JSON.stringify({ query: '{ __typename }' }),
    );
    expect(query.status).toBe(200);
    expect(query.headers['content-length']).toBe(String(Buffer.byteLength(query.body)));
    expect(query.headers['transfer-encoding']).toBeUndefined();
    const page = await serve('GET', { accept: 'text/html', 'x-forwarded-proto': 'https' });
    expect(page.status).toBe(200);
    expect(page.headers['content-length']).toBe(String(Buffer.byteLength(page.body)));
    expect(page.headers['transfer-encoding']).toBeUndefined();
  });

  test('the host serves a graphql-response+json answer with a content-length and no chunked framing', async () => {
    const answer = await serve(
      'POST',
      {
        'content-type': 'application/json',
        accept: 'application/graphql-response+json',
        'x-forwarded-proto': 'https',
      },
      JSON.stringify({ query: '{ __typename }' }),
    );
    expect(answer.status).toBe(200);
    expect(answer.headers['content-length']).toBe(String(Buffer.byteLength(answer.body)));
    expect(answer.headers['transfer-encoding']).toBeUndefined();
  });
});
