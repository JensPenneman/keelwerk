import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A local HTTP endpoint that records what it is sent and answers as the test says. */
export interface HookEndpoint {
  readonly url: string;
  readonly requests: readonly {
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  }[];
  close(): Promise<void>;
}

/**
 * Starts an endpoint on 127.0.0.1 (any free port). `answer` gets the 0-based index of each request
 * and returns the status to answer, or `'hang'` to leave the request unanswered (default: 200).
 */
export async function startHookEndpoint(
  answer: (index: number) => number | 'hang' = () => 200,
  /** Milliseconds the endpoint waits before it answers a request: concurrent requests then overlap. */
  delayMs = 0,
): Promise<HookEndpoint> {
  const requests: { headers: Record<string, string>; body: string }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        headers[name] = Array.isArray(value) ? value.join(', ') : (value ?? '');
      }
      const index = requests.length;
      requests.push({ headers, body: Buffer.concat(chunks).toString('utf8') });
      const status = answer(index);
      if (status === 'hang') return;
      setTimeout(() => {
        response.writeHead(status, { 'content-type': 'text/plain' });
        response.end(`answered ${status}`);
      }, delayMs);
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
        server.close(() => {
          done();
        });
      }),
  };
}
