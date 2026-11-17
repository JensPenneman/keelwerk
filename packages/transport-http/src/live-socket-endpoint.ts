import { asKeelwerkError } from '@keelwerk/core/http';
import { acceptLiveSocket } from './accept-live-socket.ts';
import { serveLiveSocket } from './serve-live-socket.ts';
import type { UpgradeEntry } from './upgrade-entry.ts';

/**
 * The `keelwerk.live.v1` entry of the upgrade table: after the session, the origin check and the
 * ticket check, the socket is accepted as every protocol's is (`acceptLiveSocket`), and its life runs.
 * A cookie or `Authorization` of the upgrade, or the token of the hello, are the credentials; a
 * stream ticket is not one.
 */
export const liveSocketEndpoint: UpgradeEntry['serve'] = async (call, upgrade) => {
  const accepted = await acceptLiveSocket(call, upgrade, 'keelwerk.live.v1');
  if (accepted instanceof Response) return accepted;
  const socket = accepted.open;
  void serveLiveSocket(accepted)
    .catch((failure: unknown) => {
      accepted.log.error('a live socket failed', { code: asKeelwerkError(failure).code });
    })
    .finally(() => {
      call.host.sockets.delete(socket);
    });
  return null;
};
