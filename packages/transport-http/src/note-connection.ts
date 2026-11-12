import type { Socket } from 'node:net';
import { newUuidV7 } from '@keelwerk/core';
import type { HostContext } from './host-context.ts';

/**
 * Keeps the connection id and the peer address of a socket, once: the server's 'connection' event
 * calls it when the socket opens, while the address is still known (Node answers `remoteAddress`
 * undefined once the client has reset the connection). A socket seen again keeps its record.
 */
export function noteConnection(
  ids: HostContext['connectionIds'],
  socket: Pick<Socket, 'remoteAddress'>,
): { readonly id: string; readonly peer: string | undefined } {
  const known = ids.get(socket);
  if (known !== undefined) {
    return known;
  }
  const made = { id: newUuidV7(), peer: socket.remoteAddress };
  ids.set(socket, made);
  return made;
}
