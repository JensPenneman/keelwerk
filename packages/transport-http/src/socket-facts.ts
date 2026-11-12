import type { TLSSocket } from 'node:tls';
import { type Connection, newUuidV7, unknownClientAddress } from '@keelwerk/core';
import type { HostBindings } from './host-bindings.ts';
import type { HostContext } from './host-context.ts';
import { noteConnection } from './note-connection.ts';

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
 * socket has no network address, and `host.fetch` (no socket) reports the address its caller
 * names, else the loopback. Forwarding headers are read only from a socket peer the deployment
 * trusts, never on `host.fetch`. A socket whose peer address is not known (the client reset the
 * connection before it was read) is the shared `unknownClientAddress`, never the loopback.
 */
export function socketFacts(
  host: HostContext,
  request: Request,
  bindings: HostBindings,
): SocketFacts {
  const { incoming, operatorSocket } = bindings;
  if (operatorSocket !== undefined) {
    const id =
      incoming === undefined ? newUuidV7() : noteConnection(host.connectionIds, incoming.socket).id;
    return {
      connectionId: id,
      remote: { address: 'unix', port: 0 },
      local: { address: operatorSocket, port: 0 },
      operatorSocket,
    };
  }
  const socket = incoming?.socket;
  if (socket === undefined) {
    return {
      connectionId: newUuidV7(),
      remote: { address: bindings.remoteAddress ?? loopback.address, port: 0 },
      local: loopback,
    };
  }
  const tls = tlsOf(socket);
  const connection = noteConnection(host.connectionIds, socket);
  return {
    connectionId: connection.id,
    remote: {
      address: host.proxies.clientAddress(
        connection.peer ?? socket.remoteAddress ?? unknownClientAddress,
        request.headers.get('x-forwarded-for'),
      ),
      port: socket.remotePort ?? 0,
    },
    local: { address: socket.localAddress ?? loopback.address, port: socket.localPort ?? 0 },
    ...(tls !== undefined && { tls }),
  };
}
