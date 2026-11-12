import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { clientAddresses } from '../../harness/client-addresses.ts';
import type { ConnectOptions } from './connect-options.ts';
import type { SocketUpgrade } from './socket-upgrade.ts';
import { testSocketOf } from './test-socket-of.ts';

const guid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const written: ReadonlySet<string> = new Set([
  'host',
  'connection',
  'upgrade',
  'content-length',
  'x-forwarded-for',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
]);
const answerTimeout = 10_000;

function headersOf(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      headers.append(name, entry);
    }
  }
  return headers;
}

/**
 * The suite's socket hook over a listening host: a GET upgrade over TCP to 127.0.0.1:`port`, through
 * the host's real upgrade path (session, origin check, ticket check, limits, handshake). Host is the
 * request URL's host, the path its path and query (the scheme is ignored: plain TCP to the loopback);
 * the request's headers are sent except host, connection, upgrade, content-length, x-forwarded-for
 * and sec-websocket-key/-version/-extensions, which the hook writes (key: 16 random bytes, version 13,
 * no extensions). The client address is `options.remoteAddress`, else the next of `addresses`; it is
 * sent as the one `x-forwarded-for` entry, so the host must trust the loopback. A header of the
 * request never moves it. `options.answerPings` (default true) says whether the socket answers a
 * server ping by itself. When the request's signal aborts before the answer, the connection is
 * destroyed and the call rejects with the signal's reason.
 */
export function clientConnectOf(
  port: number,
  addresses: () => string = clientAddresses(),
): (request: Request, options?: ConnectOptions) => Promise<SocketUpgrade> {
  return async (request, options) => {
    const address = options?.remoteAddress ?? addresses();
    if (isIP(address) === 0 || address.includes('%')) {
      throw new TypeError(`The client address '${address}' is no IP address.`);
    }
    const url = new URL(request.url);
    const key = randomBytes(16).toString('base64');
    const headers: Record<string, string> = {};
    for (const [name, value] of request.headers) {
      if (!written.has(name.toLowerCase())) headers[name] = value;
    }
    const { signal } = request;
    return await new Promise<SocketUpgrade>((resolve, reject) => {
      let settled = false;
      let upgraded: Duplex | undefined;
      const outgoing = httpRequest({
        host: '127.0.0.1',
        port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        headers: {
          ...headers,
          host: url.host,
          connection: 'Upgrade',
          upgrade: 'websocket',
          'x-forwarded-for': address,
          'sec-websocket-key': key,
          'sec-websocket-version': '13',
        },
      });
      const timer = setTimeout(() => {
        outgoing.destroy(new Error(`The upgrade was not answered within ${answerTimeout} ms.`));
      }, answerTimeout);
      const leave = (): void => {
        outgoing.destroy(signal.reason);
        upgraded?.destroy();
        fail(signal.reason);
      };
      const done = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', leave);
        return true;
      };
      const fail = (error: unknown): void => {
        if (done()) reject(error);
      };
      outgoing.on('error', fail);
      if (signal.aborted) {
        leave();
        return;
      }
      signal.addEventListener('abort', leave, { once: true });
      outgoing.on('upgrade', (response, socket, head) => {
        upgraded = socket;
        const accept = createHash('sha1').update(`${key}${guid}`).digest('base64');
        if (response.headers['sec-websocket-accept'] !== accept) {
          socket.destroy();
          fail(new Error('The upgrade answered a wrong Sec-WebSocket-Accept value.'));
          return;
        }
        const protocol = response.headers['sec-websocket-protocol'];
        if (!done()) return;
        upgraded = undefined;
        resolve({
          kind: 'open',
          protocol: Array.isArray(protocol) ? (protocol[0] ?? null) : (protocol ?? null),
          headers: headersOf(response.headers),
          socket: testSocketOf(socket, head, {
            ...(options?.answerPings === undefined ? {} : { answerPings: options.answerPings }),
          }),
        });
      });
      outgoing.on('response', (response) => {
        upgraded = response.socket;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', fail);
        response.on('end', () => {
          if (!done()) return;
          const status = response.statusCode ?? 0;
          const empty = status === 204 || status === 205 || status === 304;
          resolve({
            kind: 'refused',
            response: new Response(empty ? null : Buffer.concat(chunks), {
              status,
              headers: headersOf(response.headers),
            }),
          });
          response.socket.destroy();
        });
      });
      outgoing.end();
    });
  };
}
