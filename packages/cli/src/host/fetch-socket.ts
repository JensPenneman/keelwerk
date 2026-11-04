import { request } from 'node:http';
import type { HostRequest } from '../context/cli-host.ts';

/** A request over a Unix socket, answered as a standard `Response`. */
export function fetchSocket(
  socketPath: string,
  path: string,
  init: HostRequest,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { socketPath, path, method: init.method, headers: { host: 'localhost', ...init.headers } },
      (incoming) => {
        const chunks: Uint8Array[] = [];
        incoming.on('data', (chunk: Uint8Array) => chunks.push(chunk));
        incoming.on('error', reject);
        incoming.on('end', () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value !== undefined) {
              headers.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
          }
          const status = incoming.statusCode ?? 502;
          resolve(
            new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
              status,
              headers,
            }),
          );
        });
      },
    );
    outgoing.on('error', reject);
    init.signal?.addEventListener('abort', () => outgoing.destroy(init.signal?.reason as Error), {
      once: true,
    });
    outgoing.end(init.body);
  });
}
