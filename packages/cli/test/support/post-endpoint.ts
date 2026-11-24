import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A local HTTP endpoint that answers every post with 200 and counts them. */
export interface PostEndpoint {
  readonly url: string;
  readonly received: () => number;
  close(): Promise<void>;
}

export async function startPostEndpoint(): Promise<PostEndpoint> {
  let received = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      received += 1;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('answered 200');
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received: () => received,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
