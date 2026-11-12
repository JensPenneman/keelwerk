import { WebSocket } from 'ws';
import { type LiveSocketClient, liveSocketClient } from './live-socket-client.ts';

/**
 * A ws client to `ws://127.0.0.1:<port>/_keelwerk/v1/live` with `Host` = `domain`, the caller's
 * headers and the subprotocols given (default `keelwerk.live.v1`). Answers the client once the
 * handshake is done, or the refusal `{ status, body }` read from ws's `unexpected-response`.
 * `query` is appended to the path (for example `?ticket=...`). `autoPong: false` leaves the server's pings unanswered.
 */
export function connectLiveSocket(
  port: number,
  domain: string,
  headers: Record<string, string>,
  protocols: readonly string[] = ['keelwerk.live.v1'],
  options: { readonly autoPong?: boolean; readonly query?: string } = {},
): Promise<LiveSocketClient | { readonly status: number; readonly body: unknown }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/_keelwerk/v1/live${options.query ?? ''}`,
      protocols.length === 0 ? undefined : [...protocols],
      {
        headers: { host: domain, ...headers },
        perMessageDeflate: false,
        ...(options.autoPong === undefined ? {} : { autoPong: options.autoPong }),
      },
    );
    // The client must not be connected until it has been wrapped, or a message could be missed.
    socket.once('open', () => resolve(liveSocketClient(socket)));
    socket.once('unexpected-response', (_request, response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // Not JSON: the text stays as it came.
        }
        resolve({ status: response.statusCode ?? 0, body });
      });
    });
    socket.once('error', reject);
  });
}
