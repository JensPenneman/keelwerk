import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();

/** A host with one mounted route: its handler answers the body it read and counts its calls. */
function mountedHost(options: { maxBodyBytes?: number } = {}) {
  const made = setup({ listen: { port: 0 }, ...options });
  let calls = 0;
  made.host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async (request) => {
    calls += 1;
    return Response.json({ read: await request.text() });
  });
  const listening = async (): Promise<number> => {
    const { port } = await made.host.listen();
    if (port === undefined) throw new Error('the host listens on a TCP port');
    return port;
  };
  return { ...made, listening, calls: () => calls };
}

interface Framing {
  readonly header: string;
  readonly body: string;
}

/** How a request says it has no body: the three framings an HTTP/1.1 client can use. */
const framings = {
  'Content-Length: 0': { header: 'Content-Length: 0\r\n', body: '' },
  'no length at all': { header: '', body: '' },
  'chunked, the last chunk only': { header: 'Transfer-Encoding: chunked\r\n', body: '0\r\n\r\n' },
} as const satisfies Record<string, Framing>;

/**
 * The whole request text in one write; the answer is read until the server ends the connection.
 * The last request carries `Connection: close`, so the server ends it after the last answer.
 */
function exchange(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
    socket.write(text);
  });
}

const requestText = (method: string, { header, body }: Framing, last = false) =>
  `${method} /api/books HTTP/1.1\r\nHost: library.example\r\n${header}${last ? 'Connection: close\r\n' : ''}\r\n${body}`;
const statusesOf = (answer: string) =>
  [...answer.matchAll(/^HTTP\/1\.1 (\d{3})/gm)].map((match) => match[1]);
const readsOf = (answer: string) =>
  [...answer.matchAll(/\{"read":"[^"]*"\}/g)].map((match) => match[0]);

describe('a mounted handler over a listening socket, when no body bytes arrive', () => {
  const rows = ['POST', 'PUT', 'PATCH', 'DELETE'].flatMap((method) =>
    Object.entries(framings).map(([name, framing]) => ({ method, name, framing })),
  );

  it.each(rows)('reads the empty string: $method, $name', async ({ method, framing }) => {
    const { listening } = mountedHost();
    const port = await listening();
    const answer = await exchange(port, requestText(method, framing, true));
    expect(statusesOf(answer)).toEqual(['200']);
    expect(readsOf(answer)).toEqual(['{"read":""}']);
  });

  it('reads the empty string: GET, which carries no body member', async () => {
    const { listening } = mountedHost();
    const port = await listening();
    const answer = await exchange(port, requestText('GET', { header: '', body: '' }, true));
    expect(statusesOf(answer)).toEqual(['200']);
    expect(readsOf(answer)).toEqual(['{"read":""}']);
  });

  it('answers three body-less POSTs on one connection in order, none held back by leftover bytes', async () => {
    const { listening, calls } = mountedHost();
    const port = await listening();
    const answer = await exchange(
      port,
      requestText('POST', framings['Content-Length: 0']) +
        requestText('POST', framings['chunked, the last chunk only']) +
        requestText('POST', framings['no length at all'], true),
    );
    expect(statusesOf(answer)).toEqual(['200', '200', '200']);
    expect(readsOf(answer)).toEqual(['{"read":""}', '{"read":""}', '{"read":""}']);
    expect(calls()).toBe(3);
  });
});

describe('a TRACE request, over a listening socket', () => {
  const rows = [
    ['without content', { header: '', body: '' }],
    ['with Content-Length: 0', framings['Content-Length: 0']],
    ['with a Content-Length and a body', { header: 'Content-Length: 5\r\n', body: 'hello' }],
    [
      'with a chunked body',
      { header: 'Transfer-Encoding: chunked\r\n', body: '5\r\nhello\r\n0\r\n\r\n' },
    ],
  ] as const satisfies readonly (readonly [string, Framing])[];
  const allow = /^allow: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, QUERY\r$/im;

  it.each(rows)(
    'is answered 405 core.unsupported by the host, and no handler runs: %s',
    async (_name, framing) => {
      const { listening, calls } = mountedHost({ maxBodyBytes: 1 });
      const port = await listening();
      const answer = await exchange(port, requestText('TRACE', framing, true));
      expect(statusesOf(answer)).toEqual(['405']);
      expect(answer).toMatch(/^content-type: application\/problem\+json$/im);
      expect(answer).toContain('core.unsupported');
      expect(answer).toContain('The host does not serve TRACE.');
      expect(answer).toMatch(allow);
      expect(calls()).toBe(0);
    },
  );

  it('answers the envelope on a path without a problem base', async () => {
    const { listening, calls } = mountedHost();
    const port = await listening();
    const answer = await exchange(
      port,
      requestText('TRACE', framings['Content-Length: 0'], true).replace('/api/books', '/elsewhere'),
    );
    expect(statusesOf(answer)).toEqual(['405']);
    expect(answer).toMatch(/^content-type: application\/json; charset=utf-8$/im);
    expect(answer).not.toMatch(/problem\+json/);
    expect(answer).toContain('core.unsupported');
    expect(answer).toMatch(allow);
    expect(calls()).toBe(0);
  });
});

describe('the body limit of a mounted route', () => {
  const limit = 1024;
  const post = (body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
    new Request('https://library.example/api/books', {
      method: 'POST',
      body,
      headers,
      duplex: 'half',
    } as RequestInit);
  const streamOf = (size: number) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(size).fill(120));
        controller.close();
      },
    });

  it('hands the handler a body of exactly the limit whole', async () => {
    const { host, calls } = mountedHost({ maxBodyBytes: limit });
    const response = await host.fetch(post('x'.repeat(limit)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ read: 'x'.repeat(limit) });
    expect(calls()).toBe(1);
  });

  it('refuses a body one byte over, declared or not, before the handler runs', async () => {
    const { host, calls } = mountedHost({ maxBodyBytes: limit });
    const declared = await host.fetch(
      post('x'.repeat(limit + 1), { 'content-length': String(limit + 1) }),
    );
    const undeclared = await host.fetch(post(streamOf(limit + 1)));
    for (const response of [declared, undeclared]) {
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: 'core.payload_too_large' });
    }
    expect(calls()).toBe(0);
  });
});
