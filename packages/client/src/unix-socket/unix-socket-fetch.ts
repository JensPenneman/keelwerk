import { request } from 'node:http';

const bodiless: ReadonlySet<number> = new Set([101, 204, 205, 304]);

/**
 * A `fetch` that talks to a Unix domain socket over `node:http` with `socketPath`: the platform
 * `fetch` cannot reach one (S-53). Only the path and query of the URL matter; the host is ignored.
 * Pass the result as `fetch` to `createRemoteClient` with a `unix://` URL naming the same path; the
 * client refuses a mismatch (the function carries `socketPath`).
 */
export function unixSocketFetch(
  socketPath: string,
): typeof fetch & { readonly socketPath: string } {
  const send: typeof fetch = async (input, init) => {
    const source = new Request(input, init);
    const url = new URL(source.url);
    const payload = source.body === null ? undefined : Buffer.from(await source.arrayBuffer());
    const headers: Record<string, string> = {};
    source.headers.forEach((value, name) => {
      headers[name] = value;
    });
    headers.host ??= 'localhost';
    if (payload !== undefined) headers['content-length'] = String(payload.byteLength);
    return new Promise<Response>((resolve, reject) => {
      const outgoing = request(
        {
          socketPath,
          method: source.method,
          path: `${url.pathname}${url.search}`,
          headers,
          signal: source.signal,
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('error', reject);
          incoming.on('end', () => {
            const status = incoming.statusCode ?? 502;
            const answer = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              for (const item of Array.isArray(value) ? value : [value]) {
                if (item !== undefined) answer.append(name, item);
              }
            }
            resolve(
              new Response(bodiless.has(status) ? null : Buffer.concat(chunks), {
                status,
                headers: answer,
              }),
            );
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(payload);
    });
  };
  return Object.assign(send, { socketPath });
}
