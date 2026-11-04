import type { TLSSocket } from 'node:tls';
import { type Connection, newUuidV7 } from '@keelwerk/core';
import type { HostBindings } from './host-bindings.ts';
import type { HostContext } from './host-context.ts';

const loopback: Readonly<{ address: string; port: number }> = Object.freeze({
  address: '127.0.0.1',
  port: 0,
});

function tlsOf(socket: object): SocketFacts['tls'] {
  if (!('encrypted' in socket) || (socket as TLSSocket).encrypted !== true) {
    return undefined;
  }
  const tls = socket as TLSSocket;
  return {
    protocol: tls.getProtocol() ?? '',
    cipher: tls.getCipher().name,
    ...(typeof tls.servername === 'string' && { serverName: tls.servername }),
  };
}

function connectionId(host: HostContext, socket: object): string {
  const known = host.connectionIds.get(socket);
  if (known !== undefined) {
    return known;
  }
  const id = newUuidV7();
  host.connectionIds.set(socket, id);
  return id;
}

/** What the socket knows of a request, taken from the Node server or defaulted for `host.fetch`. */
export interface SocketFacts {
  readonly connectionId: string;
  readonly remote: { readonly address: string; readonly port: number };
  readonly local: { readonly address: string; readonly port: number };
  readonly tls?: Connection['tls'];
  /** The operator socket path, on requests that arrive there. */
  readonly operatorSocket?: string;
}

/**
 * What the socket knows: the remote address follows the trusted-proxy rules (S-38), the operator
 * socket has no network address, and `host.fetch` (no socket) reports the loopback.
 */
export function socketFacts(
  host: HostContext,
  request: Request,
  bindings: HostBindings,
): SocketFacts {
  const { incoming, operatorSocket } = bindings;
  if (operatorSocket !== undefined) {
    const id = incoming === undefined ? newUuidV7() : connectionId(host, incoming.socket);
    return {
      connectionId: id,
      remote: { address: 'unix', port: 0 },
      local: { address: operatorSocket, port: 0 },
      operatorSocket,
    };
  }
  const socket = incoming?.socket;
  if (socket === undefined) {
    return { connectionId: newUuidV7(), remote: loopback, local: loopback };
  }
  const tls = tlsOf(socket);
  return {
    connectionId: connectionId(host, socket),
    remote: {
      address: host.proxies.clientAddress(
        socket.remoteAddress ?? loopback.address,
        request.headers.get('x-forwarded-for'),
      ),
      port: socket.remotePort ?? 0,
    },
    local: { address: socket.localAddress ?? loopback.address, port: socket.localPort ?? 0 },
    ...(tls !== undefined && { tls }),
  };
}
