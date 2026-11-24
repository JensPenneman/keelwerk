import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A local HTTP endpoint that records what it is sent and answers 200. */
export interface PostRecorder {
  readonly url: string;
  readonly requests: readonly {
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  }[];
  close(): Promise<void>;
}

export async function startPostRecorder(): Promise<PostRecorder> {
  const requests: { headers: Record<string, string>; body: string }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        headers[name] = Array.isArray(value) ? value.join(', ') : (value ?? '');
      }
      requests.push({ headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('answered 200');
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    requests,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
