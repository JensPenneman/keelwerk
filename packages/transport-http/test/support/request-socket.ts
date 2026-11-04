import { request } from 'node:http';

/** A request over a Unix socket, answered as status, headers and text. */
export function requestSocket(
  socketPath: string,
  path: string,
  init: { readonly method: string; readonly body?: string },
): Promise<{ readonly status: number; readonly text: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        socketPath,
        path,
        method: init.method,
        headers: { host: 'localhost', 'content-type': 'application/json' },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () =>
          resolve({
            status: incoming.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end(init.body);
  });
}
