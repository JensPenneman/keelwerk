import { asKeelwerkError } from '@keelwerk/core/http';
import { acceptLiveSocket } from './accept-live-socket.ts';
import { errorResponse } from './error-response.ts';
import { serveRegisteredSocket } from './serve-registered-socket.ts';
import type { UpgradeEntry } from './upgrade-entry.ts';
import { upgradeHttpContext } from './upgrade-http-context.ts';

/**
 * The path-less entry of the upgrade table for a transport's subprotocol (16.3.3): the host has done
 * the session, the retired-version check, the origin check and the ticket check; the handler's own
 * `refuse` is asked before any slot is taken; the socket is accepted as every protocol's is
 * (`acceptLiveSocket`) and its life runs (`serveRegisteredSocket`). `firstMessage` is the close the
 * protocol gives a socket that sent nothing in time.
 */
export function registeredSocketEndpoint(
  protocol: string,
  firstMessage: { readonly code: number; readonly reason: string },
): UpgradeEntry['serve'] {
  return async (call, upgrade, registered) => {
    if (registered === undefined) {
      throw new TypeError('A registered socket endpoint needs the registration of its path.');
    }
    const refused = registered.handler.refuse?.(upgradeHttpContext(call, call.request.signal));
    if (refused !== undefined) return errorResponse(call.host, call.state, refused);
    const accepted = await acceptLiveSocket(call, upgrade, protocol);
    if (accepted instanceof Response) return accepted;
    const socket = accepted.open;
    void serveRegisteredSocket(accepted, registered, protocol, firstMessage)
      .catch((failure: unknown) => {
        accepted.log.error('a socket failed', { code: asKeelwerkError(failure).code });
      })
      .finally(() => {
        call.host.sockets.delete(socket);
      });
    return null;
  };
}
