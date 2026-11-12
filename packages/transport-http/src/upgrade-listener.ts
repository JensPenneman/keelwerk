import { type IncomingMessage, STATUS_CODES } from 'node:http';
import type { Duplex } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import type { Dispatcher } from './dispatcher.ts';
import type { HostContext } from './host-context.ts';
import type { PendingUpgrade } from './pending-upgrade.ts';

/** A Host header is a name and a port; anything that could steer the URL is refused before it is parsed. */
const hostPattern = /^[A-Za-z0-9._~-]+(?::[0-9]{1,5})?$|^\[[0-9A-Fa-f:.]+\](?::[0-9]{1,5})?$/;

function rawResponse(socket: Duplex, status: number, headers: Headers, body: Uint8Array): void {
  if (socket.destroyed) return;
  const lines = [`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Unknown'}`];
  for (const [name, value] of headers) {
    if (name === 'set-cookie' || name === 'connection' || name === 'content-length') continue;
    lines.push(`${name}: ${value}`);
  }
  for (const cookie of headers.getSetCookie()) lines.push(`set-cookie: ${cookie}`);
  lines.push('connection: close', `content-length: ${body.byteLength}`, '', '');
  socket.end(Buffer.concat([Buffer.from(lines.join('\r\n'), 'latin1'), body]), () => {
    socket.destroy();
  });
}

function requestOf(incoming: IncomingMessage, signal: AbortSignal): Request | null {
  const { host } = incoming.headers;
  const path = incoming.url ?? '';
  if (host === undefined || !hostPattern.test(host) || !path.startsWith('/')) return null;
  const encrypted = (incoming.socket as TLSSocket).encrypted === true;
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value === undefined) continue;
      for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
    }
    return new Request(new URL(`${encrypted ? 'https' : 'http'}://${host}${path}`), {
      method: incoming.method ?? 'GET',
      headers,
      signal,
    });
  } catch {
    return null;
  }
}

/**
 * The Node server's `upgrade` listener: builds the web `Request` (the scheme from the socket's TLS; a
 * Host that is no valid URL is a raw 400), runs the dispatcher with the upgrade the host may accept,
 * and unless a socket was accepted writes the response (status line, its headers, `connection:
 * close`, body) to the raw socket and destroys it. The handshake is ws's (`handleUpgrade` on the
 * host's one `WebSocketServer`, no compression, the payload bound of the host); the subprotocol it
 * answers is the one `accept` names, which ws takes first from the request's list.
 */
export function upgradeListener(
  dispatcher: Dispatcher,
  host: HostContext,
  operatorSocket?: string,
): (incoming: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (incoming, socket, head) => {
    const gone = new AbortController();
    socket.once('close', () => gone.abort());
    // Until ws takes the socket over, an error on it only ends it.
    socket.on('error', () => socket.destroy());
    const request = requestOf(incoming, gone.signal);
    if (request === null) {
      rawResponse(
        socket,
        400,
        new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
        Buffer.from('Bad Request'),
      );
      return;
    }
    let accepted = false;
    const upgrade: PendingUpgrade = {
      incoming,
      accept: (protocol, open) =>
        new Promise<boolean>((resolve) => {
          // ws answers the first subprotocol of the request, so the one the host chose goes first, alone.
          incoming.headers['sec-websocket-protocol'] = protocol;
          const refused = (): void => resolve(false);
          // A client that left before now has no 'close' event to come, and ws would never call back.
          if (socket.destroyed || gone.signal.aborted || !socket.readable || !socket.writable) {
            resolve(false);
            return;
          }
          socket.once('close', refused);
          host.webSockets.handleUpgrade(incoming, socket, head, (opened) => {
            accepted = true;
            socket.off('close', refused);
            open(opened);
            resolve(true);
          });
        }),
    };
    void dispatcher
      .handle(request, {
        incoming,
        upgrade,
        ...(operatorSocket !== undefined && { operatorSocket }),
      })
      .then(
        async (response) => {
          if (accepted) return;
          const body = new Uint8Array(await response.arrayBuffer());
          rawResponse(socket, response.status, response.headers, body);
        },
        () => {
          if (!accepted) {
            rawResponse(socket, 500, new Headers(), Buffer.from('Internal Server Error'));
          }
        },
      );
  };
}
